"""
Agent wallet manager - holds ONLY a Hyperliquid agent (API) key, never a master key.

An agent wallet is approved from your master account and can place/cancel orders
but cannot withdraw, transfer, or approve other agents (see README security section
and https://hyperliquid.gitbook.io/hyperliquid-docs/for-developers/api/nonces-and-api-wallets).
That capability boundary is what makes it acceptable for this bot to hold this key
at all - it is enforced by Hyperliquid, not by this code, so don't skip the
approval step and paste a master key in here.
"""

import getpass
import sys
from typing import Optional

import eth_account
from eth_account.signers.local import LocalAccount

from wallet.encryption import WalletEncryption

MASTER_KEY_LENGTH_HEX = 66  # "0x" + 64 hex chars


class AgentWallet:
    def __init__(self, wallet_file: str = "data/agent_wallet.enc"):
        self._wallet_file = wallet_file
        self._encryption = WalletEncryption()
        self._account: Optional[LocalAccount] = None

    @property
    def has_saved_wallet(self) -> bool:
        return WalletEncryption.file_exists(self._wallet_file)

    @property
    def address(self) -> Optional[str]:
        return self._account.address if self._account else None

    def setup_new(self) -> bool:
        print("=" * 60)
        print("Agent wallet setup")
        print("=" * 60)
        print("Paste your Hyperliquid AGENT wallet's private key - NOT your")
        print("master account key. If you haven't approved an agent yet, stop")
        print("and do that first (see README 'Security model' section).")
        print()
        secret_key = getpass.getpass("Agent private key (0x...): ").strip()
        if not secret_key.startswith("0x"):
            secret_key = "0x" + secret_key
        if len(secret_key) != MASTER_KEY_LENGTH_HEX:
            print("Invalid key length.")
            return False
        try:
            int(secret_key, 16)
        except ValueError:
            print("Invalid key: not hex.")
            return False

        print("\nSet a password to encrypt this key at rest.")
        while True:
            password = getpass.getpass("New password: ")
            ok, errors = WalletEncryption.validate_password_strength(password)
            if not ok:
                for e in errors:
                    print(f"  - {e}")
                continue
            if getpass.getpass("Confirm password: ") != password:
                print("Passwords did not match.")
                continue
            break

        self._encryption.encrypt_and_save(secret_key, password, self._wallet_file)
        self._account = eth_account.Account.from_key(secret_key)
        print(f"Saved and encrypted. Agent address: {self._account.address}")
        return True

    def unlock(self, password: Optional[str] = None) -> bool:
        if password is None:
            password = getpass.getpass("Wallet password: ")
        try:
            secret_key = self._encryption.load_and_decrypt(self._wallet_file, password)
        except (ValueError, FileNotFoundError) as e:
            print(f"Unlock failed: {e}")
            return False
        self._account = eth_account.Account.from_key(secret_key)
        return True

    def local_account(self) -> LocalAccount:
        if not self._account:
            raise RuntimeError("Wallet not unlocked")
        return self._account


if __name__ == "__main__":
    if len(sys.argv) > 1 and sys.argv[1] == "setup":
        AgentWallet().setup_new()
    else:
        print("Usage: python wallet/agent_wallet.py setup")
