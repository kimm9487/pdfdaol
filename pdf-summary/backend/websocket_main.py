# websocket_main.py
# FastAPI 없이 socketio.ASGIApp만 실행하는 웹소켓 전용 진입점

from routers.websocket.websocket import websocket_app
import uvicorn
import os

if __name__ == "__main__":
    port = int(os.getenv("WEBSOCKET_PORT", "8001"))
    uvicorn.run(websocket_app, host="0.0.0.0", port=port, log_level="info")
