"""Provider-ready LLM client for turning PaddleOCR output into JSON.

This module deliberately has no third-party dependencies.  It uses the
OpenAI Chat Completions-compatible HTTP interface, which is also offered by
several hosted and self-hosted LLM providers.  Schema validation belongs in
the next integration step; this module only obtains and parses the model's
JSON response.

Example:
    from llm.extract import extract_receipt

    extracted = extract_receipt({
        "full_text": "...",
        "pages": [{"page": 0, "texts": [...], "boxes": [...]}],
        "source_file": "receipt.jpg",
    })
"""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping
from urllib import error, request


class LLMExtractionError(RuntimeError):
    """Raised when the provider cannot produce a usable JSON object."""


class LLMConfigurationError(LLMExtractionError):
    """Raised when required LLM configuration is missing or invalid."""


@dataclass(frozen=True)
class LLMConfig:
    """Runtime settings read from environment variables."""

    provider: str
    api_key: str
    api_base_url: str
    model: str
    timeout_seconds: int
    ocr_max_chars: int

    @classmethod
    def from_env(cls) -> "LLMConfig":
        _load_project_env()
        provider = os.getenv("LLM_PROVIDER", "mock").strip().lower()
        if provider not in {"mock", "openai", "openai_compatible"}:
            raise LLMConfigurationError(
                "LLM_PROVIDER must be mock, openai, or openai_compatible."
            )

        return cls(
            provider=provider,
            api_key=os.getenv("LLM_API_KEY", "").strip(),
            api_base_url=os.getenv(
                "LLM_API_BASE_URL", "https://api.openai.com/v1"
            ).rstrip("/"),
            model=os.getenv("LLM_MODEL", "").strip(),
            timeout_seconds=_positive_int("LLM_TIMEOUT_SECONDS", 45),
            ocr_max_chars=_positive_int("LLM_OCR_MAX_CHARS", 24000),
        )


def _positive_int(variable_name: str, default: int) -> int:
    value = os.getenv(variable_name, str(default)).strip()
    try:
        parsed = int(value)
    except ValueError as exc:
        raise LLMConfigurationError(
            f"{variable_name} must be a positive integer."
        ) from exc
    if parsed <= 0:
        raise LLMConfigurationError(f"{variable_name} must be a positive integer.")
    return parsed


def _load_project_env() -> None:
    """Load simple KEY=VALUE entries from the root .env without dependencies.

    Values already supplied by the operating system take priority, which keeps
    production secret injection compatible with this local development setup.
    """

    env_file = Path(__file__).resolve().parents[1] / ".env"
    try:
        lines = env_file.read_text(encoding="utf-8").splitlines()
    except FileNotFoundError:
        return

    for raw_line in lines:
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if not key:
            continue
        value = value.strip()
        if len(value) >= 2 and value[0] == value[-1] and value[0] in {"\"", "'"}:
            value = value[1:-1]
        os.environ.setdefault(key, value)


SYSTEM_PROMPT = """You extract structured receipt data from PaddleOCR output.
Return only a single JSON object: no Markdown, prose, or code fences.
Use the supplied text and layout information as evidence. Do not invent facts;
when a value cannot be determined, use null and assign it low confidence.
The precise response schema is enforced by the application separately."""


def extract_receipt(
    ocr_payload: Mapping[str, Any], *, config: LLMConfig | None = None
) -> dict[str, Any]:
    """Send PaddleOCR output to the configured LLM and return its JSON object.

    `ocr_payload` must contain `full_text` (a string). `pages` and
    `source_file` are optional. The function is synchronous so it is simple to
    call from a future worker process; do not call it directly in a web request
    handler once the pipeline is made asynchronous.
    """

    if not isinstance(ocr_payload, Mapping):
        raise TypeError("ocr_payload must be a mapping returned by the OCR service.")

    active_config = config or LLMConfig.from_env()
    prompt = _build_user_prompt(ocr_payload, active_config.ocr_max_chars)

    if active_config.provider == "mock":
        return _mock_response(ocr_payload)

    if not active_config.api_key:
        raise LLMConfigurationError(
            "LLM_API_KEY is required when LLM_PROVIDER is not mock."
        )
    if not active_config.model:
        raise LLMConfigurationError(
            "LLM_MODEL is required when LLM_PROVIDER is not mock."
        )

    provider_response = _call_openai_compatible_api(
        prompt=prompt,
        config=active_config,
    )
    content = _get_completion_content(provider_response)
    return _parse_json_object(content)


def _build_user_prompt(ocr_payload: Mapping[str, Any], max_chars: int) -> str:
    full_text = ocr_payload.get("full_text", "")
    if not isinstance(full_text, str):
        raise TypeError("ocr_payload.full_text must be a string.")

    evidence = {
        "source_file": ocr_payload.get("source_file"),
        "full_text": full_text[:max_chars],
        "pages": _compact_pages(ocr_payload.get("pages"), max_chars),
    }
    return "OCR evidence follows.\n" + json.dumps(
        evidence, ensure_ascii=False, separators=(",", ":")
    )


def _compact_pages(pages: Any, max_chars: int) -> list[dict[str, Any]]:
    """Keep text, confidence scores, and boxes while bounding prompt size."""

    if not isinstance(pages, list):
        return []

    compact: list[dict[str, Any]] = []
    used_chars = 0
    for page_index, page in enumerate(pages):
        if not isinstance(page, Mapping):
            continue
        texts = page.get("texts", [])
        scores = page.get("scores", [])
        boxes = page.get("boxes", [])
        if not isinstance(texts, list):
            continue

        lines: list[dict[str, Any]] = []
        for line_index, text in enumerate(texts):
            if not isinstance(text, str):
                continue
            if used_chars + len(text) > max_chars:
                break
            line: dict[str, Any] = {"text": text}
            if isinstance(scores, list) and line_index < len(scores):
                line["ocr_confidence"] = scores[line_index]
            if isinstance(boxes, list) and line_index < len(boxes):
                line["box"] = boxes[line_index]
            lines.append(line)
            used_chars += len(text)

        compact.append({"page": page.get("page", page_index), "lines": lines})
        if used_chars >= max_chars:
            break
    return compact


def _call_openai_compatible_api(*, prompt: str, config: LLMConfig) -> dict[str, Any]:
    body = {
        "model": config.model,
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": prompt},
        ],
        # This is supported by OpenAI and many compatible APIs. Remove it only
        # if the selected provider explicitly does not support JSON mode.
        "response_format": {"type": "json_object"},
        "temperature": 0,
    }
    encoded_body = json.dumps(body).encode("utf-8")
    http_request = request.Request(
        f"{config.api_base_url}/chat/completions",
        data=encoded_body,
        headers={
            "Authorization": f"Bearer {config.api_key}",
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with request.urlopen(http_request, timeout=config.timeout_seconds) as response:
            response_body = response.read().decode("utf-8")
    except error.HTTPError as exc:
        details = exc.read().decode("utf-8", errors="replace")[:1000]
        raise LLMExtractionError(
            f"LLM request failed with HTTP {exc.code}: {details}"
        ) from exc
    except error.URLError as exc:
        raise LLMExtractionError(f"Could not reach LLM provider: {exc.reason}") from exc

    try:
        decoded = json.loads(response_body)
    except json.JSONDecodeError as exc:
        raise LLMExtractionError("LLM provider returned non-JSON HTTP content.") from exc
    if not isinstance(decoded, dict):
        raise LLMExtractionError("LLM provider returned an unexpected response shape.")
    return decoded


def _get_completion_content(provider_response: Mapping[str, Any]) -> str:
    try:
        content = provider_response["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError) as exc:
        raise LLMExtractionError(
            "LLM provider response has no choices[0].message.content."
        ) from exc
    if not isinstance(content, str):
        raise LLMExtractionError("LLM response content is not text.")
    return content


def _parse_json_object(content: str) -> dict[str, Any]:
    # JSON mode should make this unnecessary, but it provides a helpful error
    # if a compatible provider still wraps its answer in a fenced code block.
    cleaned = re.sub(r"^\s*```(?:json)?\s*|\s*```\s*$", "", content).strip()
    try:
        result = json.loads(cleaned)
    except json.JSONDecodeError as exc:
        raise LLMExtractionError("LLM response was not valid JSON.") from exc
    if not isinstance(result, dict):
        raise LLMExtractionError("LLM response must be a JSON object.")
    return result


def _mock_response(ocr_payload: Mapping[str, Any]) -> dict[str, Any]:
    """Return an injected fixture while developing without a paid LLM call."""

    fixture = ocr_payload.get("mock_llm_response")
    if isinstance(fixture, dict):
        return fixture
    raise LLMConfigurationError(
        "LLM_PROVIDER is mock. Supply ocr_payload['mock_llm_response'] for a "
        "local test, or set LLM_PROVIDER and credentials for your selected LLM."
    )


def _main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract receipt JSON from a PaddleOCR JSON payload."
    )
    parser.add_argument("input", type=Path, help="Path to a PaddleOCR JSON file")
    args = parser.parse_args()
    try:
        payload = json.loads(args.input.read_text(encoding="utf-8"))
        print(json.dumps(extract_receipt(payload), ensure_ascii=False, indent=2))
    except (OSError, json.JSONDecodeError, LLMExtractionError, TypeError) as exc:
        print(f"LLM extraction failed: {exc}", file=sys.stderr)
        raise SystemExit(1) from exc


if __name__ == "__main__":
    _main()
