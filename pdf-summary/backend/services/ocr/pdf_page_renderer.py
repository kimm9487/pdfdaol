from fastapi import HTTPException


def render_pdf_to_images(pdf_bytes: bytes, scale: float = 2.0):
    """Render PDF bytes to PIL images. Prefer pypdfium2 to avoid Poppler dependency on Windows."""
    if not pdf_bytes:
        raise HTTPException(status_code=422, detail="파일이 비어있습니다.")

    try:
        import pypdfium2 as pdfium

        pdf = pdfium.PdfDocument(pdf_bytes)
        total_pages = len(pdf)
        if total_pages == 0:
            raise HTTPException(status_code=422, detail="PDF에 페이지가 없습니다.")

        images = []
        for page_index in range(total_pages):
            page = pdf[page_index]
            bitmap = page.render(scale=scale)
            images.append(bitmap.to_pil().convert("RGB"))
            page.close()

        pdf.close()
        return images

    except ImportError:
        # Fallback path for environments without pypdfium2.
        try:
            from pdf2image import convert_from_bytes

            images = convert_from_bytes(pdf_bytes, dpi=200)
            if not images:
                raise HTTPException(status_code=422, detail="PDF 이미지 변환 결과가 없습니다.")
            return images
        except Exception as exc:
            raise HTTPException(
                status_code=422,
                detail=(
                    "PDF 이미지 렌더링 실패: pypdfium2 또는 poppler 환경이 필요합니다. "
                    f"원인: {exc}"
                ),
            )
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"PDF 렌더링 실패: {exc}")
