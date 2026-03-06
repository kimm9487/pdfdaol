from PIL import Image, ImageOps


def preprocess_for_ocr(image: Image.Image) -> Image.Image:
    """Apply lightweight preprocessing to improve OCR recall on scanned PDFs."""
    gray = ImageOps.grayscale(image)
    enhanced = ImageOps.autocontrast(gray)

    # Simple binary threshold for low-contrast scans.
    binary = enhanced.point(lambda x: 255 if x > 150 else 0, mode="1").convert("L")

    # Upscale small scans for better OCR quality.
    width, height = binary.size
    if width < 1600:
        scale = 2
        binary = binary.resize((width * scale, height * scale), Image.Resampling.LANCZOS)

    return binary
