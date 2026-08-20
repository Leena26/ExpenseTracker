import os
from flask import Flask, request, jsonify
import requests
import json
import logging

app = Flask(__name__)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

OLLAMA_URL = "http://localhost:11434/api/chat"
MODEL = "qwen3:1.7b"

RECEIPT_SCHEMA = {
    "type": "object",
    "additionalProperties": False,
    "required": [
        "date",
        "vendor",
        "amount",
        "currency",
        "category",
        "line_items",
        "confidence",
        "overall_confidence"
    ],
    "properties": {
        "date": {
            "type": ["string", "null"]
        },
        "vendor": {
            "type": ["string", "null"]
        },
        "amount": {
            "type": ["number", "null"]
        },
        "currency": {
            "type": ["string", "null"]
        },
        "category": {
            "type": ["string", "null"]
        },
        "line_items": {
            "type": "array",
            "items": {
                "type": "object",
                "additionalProperties": False,
                "required": [
                    "description",
                    "quantity",
                    "unit_price",
                    "total_price"
                ],
                "properties": {
                    "description": {
                        "type": ["string", "null"]
                    },
                    "quantity": {
                        "type": ["number", "null"]
                    },
                    "unit_price": {
                        "type": ["number", "null"]
                    },
                    "total_price": {
                        "type": ["number", "null"]
                    }
                }
            }
        },
        "confidence": {
            "type": "object",
            "additionalProperties": False,
            "required": [
                "date",
                "vendor",
                "amount",
                "currency",
                "category",
                "line_items"
            ],
            "properties": {
                "date": {"type": "number"},
                "vendor": {"type": "number"},
                "amount": {"type": "number"},
                "currency": {"type": "number"},
                "category": {"type": "number"},
                "line_items": {"type": "number"}
            }
        },
        "overall_confidence": {
            "type": "number"
        }
    }
}

@app.route("/extract", methods=["POST"])
def extract_endpoint():

    try:

        data = request.get_json(silent=True)

        if not data:
            return jsonify({
                "success": False,
                "error": "Request body must be JSON"
            }), 400

        prompt = data.get("prompt")

        if not isinstance(prompt, str) or not prompt.strip():
            return jsonify({
                "success": False,
                "error": "Missing or empty 'prompt' field"
            }), 400

        logger.info("Sending extraction request to Ollama...")

        payload = {
            "model": MODEL,

            "messages": [
                {
                    "role": "user",
                    "content": prompt
                }
            ],

            # IMPORTANT:
            # Disable Qwen's reasoning for this extraction task.
            "think": False,

            # Force JSON output.
            "format":RECEIPT_SCHEMA,
            "stream": False,

            "options": {
                "temperature": 0,
                "num_predict": 500
            }
        }

        logger.info("Using structured receipt schema")
        logger.info("Required fields: %s", RECEIPT_SCHEMA.get("required"))

        response = requests.post(
            OLLAMA_URL,
            json=payload,
            timeout=180
        )

        response.raise_for_status()

        result = response.json()

        content = (
            result
            .get("message", {})
            .get("content", "")
        )

        if not content:
            raise RuntimeError(
                "Qwen returned empty output."
            )

        logger.info(
            "Raw Qwen output: %s",
            content
        )

        # --------------------------------------------------
        # Parse JSON returned by Qwen
        # --------------------------------------------------

        try:

            extracted = json.loads(content)

        except json.JSONDecodeError as e:

            logger.error(
                "Qwen returned invalid JSON: %s",
                content
            )

            return jsonify({
                "success": False,
                "error": "Qwen returned invalid JSON",
                "raw_output": content
            }), 200

        # --------------------------------------------------
        # Make sure we got an object
        # --------------------------------------------------

        if (
            not isinstance(extracted, dict)
        ):

            return jsonify({
                "success": False,
                "error": "Qwen response must be a JSON object",
                "raw_output": content
            }), 200

        # --------------------------------------------------
        # Return result to Node
        # --------------------------------------------------

        return jsonify({
            "success": True,
            "data": extracted
        })

    except requests.exceptions.RequestException as e:

        logger.exception(
            "Ollama request failed"
        )

        return jsonify({
            "success": False,
            "error": f"Ollama request failed: {str(e)}"
        }), 500

    except Exception as e:

        logger.exception(
            "Qwen extraction failed"
        )

        return jsonify({
            "success": False,
            "error": str(e)
        }), 500


@app.route("/health", methods=["GET"])
def health():

    return jsonify({
        "status": "ok",
        "model": MODEL
    })


if __name__ == "__main__":

    logger.info(
        "Starting Qwen extraction service..."
    )

    logger.info(
        "Model: %s",
        MODEL
    )

    logger.info(
        "Ollama: %s",
        OLLAMA_URL
    )

    app.run(
        host="127.0.0.1",
        port=5002,
        debug=False
    )