import os
from dotenv import load_dotenv

load_dotenv()


class Settings:
    FRED_API_KEY: str = os.getenv("FRED_API_KEY", "")
    FRONTEND_ORIGIN: str = os.getenv("FRONTEND_ORIGIN", "http://localhost:3000")


settings = Settings()
