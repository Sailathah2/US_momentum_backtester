"""
==========================================================
auth.py  --  who is allowed in
==========================================================

WHAT THIS FILE DOES (in plain English)
--------------------------------------
It keeps a small list of users and checks their passwords, so the portal can
sit behind a login screen instead of being open to anyone who can reach it.

HOW PASSWORDS ARE STORED
------------------------
They are **not**. We never write a password down anywhere.

Instead we store a one-way "hash" - a scrambled fingerprint that can be
checked against a password but cannot be turned back into one. When someone
logs in we scramble what they typed the same way and compare fingerprints.
Even with the users file in hand, an attacker cannot read the passwords out
of it.

The scrambling uses PBKDF2 with a random salt per user, which is the same
family of algorithm banks use. It is deliberately slow, which makes guessing
millions of passwords impractical.

HOW "STAYING LOGGED IN" WORKS
-----------------------------
After a correct password we hand the browser a **signed token** - a short
string that says "this is Sai, issued at 3pm". It is signed with a secret
key only this server knows, so nobody can forge one or edit the name inside.
The token expires on its own after a while.

The browser sends that token back with every request. No password is ever
sent again after the initial login.
"""

import functools
import json
import os
import secrets
import time
from datetime import datetime

from flask import jsonify, request
from itsdangerous import BadSignature, SignatureExpired, URLSafeTimedSerializer
from werkzeug.security import check_password_hash, generate_password_hash

# ----------------------------------------------------------------------
# SETTINGS YOU MAY WANT TO CHANGE
# ----------------------------------------------------------------------

# Where the user list lives. This file holds only usernames and password
# HASHES - never a readable password - but it is still gitignored so it
# cannot be committed by accident.
HERE = os.path.dirname(os.path.abspath(__file__))
USERS_FILE = os.path.join(HERE, "users.json")
SECRET_FILE = os.path.join(HERE, ".secret_key")

# How long a login lasts before the user has to sign in again.
TOKEN_HOURS = 12

# Brute-force protection: after this many wrong passwords in a row, that
# username is frozen for a while. The freeze is what makes guessing
# impractical, far more than any password rule.
MAX_ATTEMPTS = 5
LOCKOUT_SECONDS = 300

# Turn the whole thing off for solo local use. Set REQUIRE_LOGIN=0 in the
# environment and the portal behaves exactly as it did before there was a
# login screen. It is ON by default - the safe direction.
REQUIRE_LOGIN = os.environ.get("REQUIRE_LOGIN", "1") not in ("0", "false", "False", "no")


# ======================================================================
# SECTION 1 - THE SIGNING SECRET
# ======================================================================

def _load_secret():
    """
    Fetch the key used to sign login tokens.

    Order of preference:
      1. The PORTAL_SECRET environment variable - the right way in production,
         because the key never touches the disk.
      2. A .secret_key file next to this script, generated once on first run.

    If the key ever changes, every existing token stops working and everyone
    simply has to log in again. Nothing is lost.
    """
    from_env = os.environ.get("PORTAL_SECRET")
    if from_env:
        return from_env

    if os.path.exists(SECRET_FILE):
        with open(SECRET_FILE, "r", encoding="utf-8") as handle:
            saved = handle.read().strip()
            if saved:
                return saved

    # First run: invent a long random key and keep it.
    fresh = secrets.token_urlsafe(48)
    with open(SECRET_FILE, "w", encoding="utf-8") as handle:
        handle.write(fresh)
    try:
        os.chmod(SECRET_FILE, 0o600)   # owner-only, where the OS honours it
    except OSError:
        pass
    return fresh


_serializer = URLSafeTimedSerializer(_load_secret(), salt="momentum-portal-login")

# Failed attempts, kept in memory: {username: [count, locked_until_timestamp]}
_failures = {}


# ======================================================================
# SECTION 2 - THE USER LIST
# ======================================================================

def load_users():
    """Read the user file. Returns {} when nobody has been created yet."""
    if not os.path.exists(USERS_FILE):
        return {}
    try:
        with open(USERS_FILE, "r", encoding="utf-8") as handle:
            return json.load(handle)
    except (json.JSONDecodeError, OSError):
        return {}


def save_users(users):
    """Write the user file back to disk, owner-readable only."""
    with open(USERS_FILE, "w", encoding="utf-8") as handle:
        json.dump(users, handle, indent=2)
    try:
        os.chmod(USERS_FILE, 0o600)
    except OSError:
        pass


def add_user(username, password):
    """
    Create a user, or change an existing user's password.

    The password is hashed immediately and the plain text is never stored,
    logged, or returned.
    """
    username = str(username).strip().lower()
    if not username:
        raise ValueError("A username is required.")
    if len(password) < 8:
        raise ValueError("Please use a password of at least 8 characters.")

    users = load_users()
    users[username] = {
        "password_hash": generate_password_hash(password, method="pbkdf2:sha256:260000"),
        "created": datetime.now().isoformat(timespec="seconds"),
    }
    save_users(users)
    return username


def remove_user(username):
    """Delete a user. Returns True if there was one to delete."""
    users = load_users()
    if username.strip().lower() in users:
        users.pop(username.strip().lower())
        save_users(users)
        return True
    return False


def any_users_exist():
    """Has anyone been set up yet? Used to show a helpful first-run message."""
    return bool(load_users())


# ======================================================================
# SECTION 3 - LOGGING IN
# ======================================================================

def _lock_state(username):
    """How many failures this username has, and whether it is frozen."""
    count, until = _failures.get(username, (0, 0.0))
    if until and time.time() > until:
        _failures.pop(username, None)      # the freeze has expired
        return 0, 0.0
    return count, until


def attempt_login(username, password):
    """
    Check a username and password.

    Returns (token, error). Exactly one of them is None.

    The error message never says whether it was the username or the password
    that was wrong - telling an attacker "that user exists" hands them half
    the answer for free.
    """
    username = str(username or "").strip().lower()
    password = str(password or "")

    if not username or not password:
        return None, "Please enter both a username and a password."

    count, until = _lock_state(username)
    if until:
        wait = int(until - time.time())
        return None, (f"Too many failed attempts. Try again in {wait} seconds.")

    users = load_users()
    record = users.get(username)

    # Always run a hash comparison, even when the user does not exist, so the
    # reply takes the same time either way. A faster "no such user" reply is
    # itself a clue an attacker can use to harvest valid usernames.
    stored = record["password_hash"] if record else generate_password_hash("decoy-value")
    good = check_password_hash(stored, password) and record is not None

    if not good:
        count += 1
        if count >= MAX_ATTEMPTS:
            _failures[username] = (count, time.time() + LOCKOUT_SECONDS)
            return None, (f"Too many failed attempts. This account is locked for "
                          f"{LOCKOUT_SECONDS // 60} minutes.")
        _failures[username] = (count, 0.0)
        remaining = MAX_ATTEMPTS - count
        return None, f"Incorrect username or password. {remaining} attempt(s) left."

    _failures.pop(username, None)          # a good login clears the counter
    return _serializer.dumps({"u": username}), None


def verify_token(token):
    """Return the username inside a token, or None if it is bad or expired."""
    if not token:
        return None
    try:
        data = _serializer.loads(token, max_age=TOKEN_HOURS * 3600)
        return data.get("u")
    except (BadSignature, SignatureExpired, Exception):
        return None


def current_user():
    """Who is making this request? None when nobody is signed in."""
    header = request.headers.get("Authorization", "")
    if header.startswith("Bearer "):
        return verify_token(header[7:])
    return None


# ======================================================================
# SECTION 4 - PROTECTING THE ENDPOINTS
# ======================================================================

def login_required(view):
    """
    Put this above a route and it can only be reached by someone signed in.

    Replies 401 when the token is missing or stale, which the website reads
    as "show the login screen again".
    """
    @functools.wraps(view)
    def guarded(*args, **kwargs):
        if not REQUIRE_LOGIN:
            return view(*args, **kwargs)

        # Nobody set up yet: let the first run through rather than locking
        # the owner out of their own portal with no way to create an account.
        if not any_users_exist():
            return view(*args, **kwargs)

        if current_user() is None:
            return jsonify({
                "ok": False,
                "error": "Your session has expired. Please sign in again.",
                "auth_required": True,
            }), 401
        return view(*args, **kwargs)

    return guarded
