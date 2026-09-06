"""
Password-based encryption for the agent wallet's private key.

Never stores the key in plaintext. Uses PBKDF2-HMAC-SHA256 to derive a key from
the user's password (with a random per-file salt), and Fernet (AES-128-CBC +
HMAC, authenticated) to encrypt. This is the same class of approach as
Polymarket-bot's wallet/encryption.py, adapted to stdlib `cryptography` primitives.
"""

import base64
import json
import os
from dataclasses import dataclass
from pathlib import Path

from cryptography.fernet import Fernet, InvalidToken
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

PBKDF2_ITERATIONS = 600_000  # OWASP 2023+ recommendation for PBKDF2-SHA256


@dataclass
class EncryptedData:
    salt_b64: str
    ciphertext_b64: str


class WalletEncryption:
    @staticmethod
    def _derive_key(password: str, salt: bytes) -> bytes:
        kdf = PBKDF2HMAC(
            algorithm=hashes.SHA256(),
            length=32,
            salt=salt,
            iterations=PBKDF2_ITERATIONS,
        )
        return base64.urlsafe_b64encode(kdf.derive(password.encode("utf-8")))

    @staticmethod
    def validate_password_strength(password: str) -> tuple[bool, list[str]]:
        errors = []
        if len(password) < 12:
            errors.append("Password must be at least 12 characters")
        if not any(c.isupper() for c in password):
            errors.append("Password must include an uppercase letter")
        if not any(c.isdigit() for c in password):
            errors.append("Password must include a digit")
        return (len(errors) == 0, errors)

    def encrypt_and_save(self, secret: str, password: str, filepath: str) -> None:
        salt = os.urandom(16)
        key = self._derive_key(password, salt)
        ciphertext = Fernet(key).encrypt(secret.encode("utf-8"))
        payload = {
            "salt_b64": base64.b64encode(salt).decode("ascii"),
            "ciphertext_b64": base64.b64encode(ciphertext).decode("ascii"),
        }
        path = Path(filepath)
        path.parent.mkdir(parents=True, exist_ok=True)
        with open(path, "w") as f:
            json.dump(payload, f)
        os.chmod(path, 0o600)  # owner read/write only

    def load_and_decrypt(self, filepath: str, password: str) -> str:
        with open(filepath) as f:
            payload = json.load(f)
        salt = base64.b64decode(payload["salt_b64"])
        ciphertext = base64.b64decode(payload["ciphertext_b64"])
        key = self._derive_key(password, salt)
        try:
            return Fernet(key).decrypt(ciphertext).decode("utf-8")
        except InvalidToken:
            raise ValueError("Incorrect password or corrupted wallet file")

    @staticmethod
    def file_exists(filepath: str) -> bool:
        return Path(filepath).exists()
