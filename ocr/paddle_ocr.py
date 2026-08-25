import os
os.environ["FLAGS_use_mkldnn"] = "0"

from flask import Flask, request, jsonify
from paddleocr import PaddleOCR
import tempfile
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
app = Flask(__name__)

logger.info("Loading PaddleOCR models...")
ocr = PaddleOCR(
    use_textline_orientation=False,
    lang="en",
    enable_mkldnn=False
)
logger.info("Models loaded. Ready to serve.")

ALLOWED_EXTENSIONS = {".png", ".jpg", ".jpeg", ".pdf", ".bmp", ".tiff"}

# To check if server is running before sending requests
@app.route("/health", methods=["GET"])
def health():
    return jsonify({"status": "ok"}), 200

@app.route("/ocr", methods=["POST"])
def ocr_endpoint():
    if "receipt" not in request.files:
        return jsonify({"error": "No file provided"}), 400

    file = request.files["receipt"]
    ext = os.path.splitext(file.filename)[1].lower()

    if ext not in ALLOWED_EXTENSIONS:
        return jsonify({"error": f"Invalid file type: {ext}"}), 400

    tmp_path = None
    page_tmp_paths = []

    try:
        with tempfile.NamedTemporaryFile(delete=False, suffix=ext) as tmp:
            file.save(tmp.name)
            tmp_path = tmp.name

        images_to_process = [tmp_path]
        if ext == ".pdf":
            try:
                from pdf2image import convert_from_path
                images_to_process = []
                from pdf2image.pdf2image import pdfinfo_from_path

                info = pdfinfo_from_path(
                    tmp_path,
                    poppler_path=r"C:\Users\Leena Abigail Dany\Release-26.02.0-0\poppler-26.02.0\Library\bin"
                )

                total_pages = int(info["Pages"])

                logger.info("PDF contains %d pages", total_pages)

                for page_num in range(1, total_pages + 1):

                    logger.info(
                        "Converting PDF page %d/%d...",
                        page_num,
                        total_pages
                    )

                    pages = convert_from_path(
                        tmp_path,
                        dpi=100,
                        first_page=page_num,
                        last_page=page_num,
                        poppler_path=r"C:\Users\Leena Abigail Dany\Release-26.02.0-0\poppler-26.02.0\Library\bin"
                    )

                    if not pages:
                        continue

                    img = pages[0]
                    max_width = 1600

                    if img.width > max_width:
                        ratio = max_width / img.width
                        new_height = int(img.height * ratio)

                        img = img.resize((max_width, new_height))

                    page_tmp = tempfile.NamedTemporaryFile(
                        delete=False,
                        suffix=".png"
                    )

                    img.save(
                        page_tmp.name,
                        format="PNG"
                    )

                    page_tmp.close()

                    images_to_process.append(page_tmp.name)
                    page_tmp_paths.append(page_tmp.name)

                    logger.info(
                        "PDF page %d/%d converted successfully",
                        page_num,
                        total_pages
                    )

            except Exception as pdf_exc:
                logger.warning(
                    "pdf2image not available or conversion failed: %s",
                    pdf_exc
                )

                return jsonify({
                    "error": (
                        "PDF uploaded but pdf2image/poppler not available "
                        "on server. Please upload images or install "
                        "pdf2image and poppler."
                    )
                }), 400
    
        pages = []
        all_texts = []
     
        for page_index, img_path in enumerate(images_to_process):
            logger.info(
                "Processing page %d/%d: %s | exists=%s | size=%s bytes",
                page_index + 1,
                len(images_to_process),
                img_path,
                os.path.exists(img_path),
                os.path.getsize(img_path) if os.path.exists(img_path) else "N/A"
            )

            logger.info(
                "Starting PaddleOCR for page %d/%d...",
                page_index + 1,
                len(images_to_process)
            )

            result = ocr.predict(img_path)

            logger.info(
                "PaddleOCR completed for page %d/%d",
                page_index + 1,
                len(images_to_process)
            )

            texts = []
            scores = []
            boxes = []

            for res in result:
                try:
                    data = res.json
                    rec_texts = data["res"]["rec_texts"]
                    rec_scores = data["res"]["rec_scores"]
                    rec_boxes = data["res"]["rec_boxes"]

                    texts.extend(rec_texts)
                    scores.extend([float(score) for score in rec_scores])

                    for box in rec_boxes:
                        boxes.append([
                            [float(box[0]), float(box[1])],
                            [float(box[2]), float(box[1])],
                            [float(box[2]), float(box[3])],
                            [float(box[0]), float(box[3])]
                        ])

                except Exception as e:
                    logger.warning("Could not parse OCR result: %s", e)

            pages.append({
                "page": page_index,
                "texts": texts,
                "scores": scores,
                "boxes": boxes,
            })
            all_texts.extend(texts)

        full_text = "\n".join(all_texts)

        return jsonify({
            "success": True,
            "full_text": full_text,
            "pages": pages,
        })

    except Exception as e:
        logger.exception("OCR Failed")
        return jsonify({"error": str(e)}), 500

    finally:
        try:
            if tmp_path and os.path.exists(tmp_path):
                os.remove(tmp_path)
        except Exception:
            pass

        for p in page_tmp_paths:
            try:
                if os.path.exists(p):
                    os.remove(p)
            except Exception:
                pass

if __name__ == "__main__":
    app.run(host="0.0.0.0", port=5001)