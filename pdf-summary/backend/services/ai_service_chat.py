import asyncio
import os
from typing import AsyncIterator, Optional, List, Dict

from services.ai_service import (
    summarize_with_instruction as _summarize_with_instruction,
    summarize_with_instruction_stream as _summarize_with_instruction_stream,
)


CHAT_DEFAULT_MODEL = os.getenv("CHAT_DEFAULT_MODEL", "phi3:mini")


async def summarize_with_instruction(
    text: str,
    instruction: str,
    model: str = CHAT_DEFAULT_MODEL,
    user_scope: str = "shared",
    use_rag: bool = True,
    use_lora: bool = False,
    conversation_history: Optional[List[Dict[str, str]]] = None,
) -> str:
    selected_model = model or CHAT_DEFAULT_MODEL
    return await _summarize_with_instruction(
        text=text,
        instruction=instruction,
        model=selected_model,
        user_scope=user_scope,
        use_rag=use_rag,
        use_lora=use_lora,
        conversation_history=conversation_history or [],
    )


async def summarize_with_instruction_stream(
    text: str,
    instruction: str,
    model: str = CHAT_DEFAULT_MODEL,
    user_scope: str = "shared",
    use_rag: bool = True,
    use_lora: bool = False,
    conversation_history: Optional[List[Dict[str, str]]] = None,
    cancel_event: Optional[asyncio.Event] = None,
) -> AsyncIterator[str]:
    selected_model = model or CHAT_DEFAULT_MODEL
    async for token in _summarize_with_instruction_stream(
        text=text,
        instruction=instruction,
        model=selected_model,
        user_scope=user_scope,
        use_rag=use_rag,
        use_lora=use_lora,
        conversation_history=conversation_history or [],
        cancel_event=cancel_event,
    ):
        yield token
