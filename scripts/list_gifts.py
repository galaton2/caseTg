"""
Вспомогательный скрипт для админа. Показывает список настоящих подарков
Telegram, которые ваш бот может дарить, вместе с их id и ценой в звёздах.

Запуск (из папки backend, после установки зависимостей и настройки .env):
    python ../scripts/list_gifts.py

Полученные gift_id впишите в backend/cases_config.py в поле real_gift_id
у тех предметов, которые должны выдавать настоящий подарок при выводе.

Важно: чтобы отправлять подарки, у бота должен быть достаточный баланс
звёзд (он пополняется автоматически из звёзд, которые платят пользователи,
либо докупается вручную через @PremiumBot).
"""
import asyncio
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "backend"))

from aiogram import Bot  # noqa: E402
from config import BOT_TOKEN  # noqa: E402


async def main():
    if not BOT_TOKEN:
        print("BOT_TOKEN не задан в backend/.env")
        return
    bot = Bot(token=BOT_TOKEN)
    gifts = await bot.get_available_gifts()
    for g in gifts.gifts:
        print(f"id={g.id:<20} price={g.star_count:<6}⭐  limited={bool(getattr(g, 'total_count', None))}")
    await bot.session.close()


if __name__ == "__main__":
    asyncio.run(main())
