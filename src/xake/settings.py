from loguru import logger

from .schema.settings import AppSettings

current_settings = AppSettings.model_validate({})
logger.info("Application Settings: {}", current_settings)
