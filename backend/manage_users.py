"""
==========================================================
manage_users.py  --  create and manage portal logins
==========================================================

Run this from the backend folder to set up who can sign in.

    python manage_users.py add sai              # generates a strong password
    python manage_users.py add sai --ask        # you type the password instead
    python manage_users.py list
    python manage_users.py remove sai
    python manage_users.py reset sai            # new generated password

WHY A COMMAND AND NOT A SIGN-UP PAGE
------------------------------------
A sign-up page on a personal research tool is a liability: anyone who finds
the address can create themselves an account. Accounts are created here, by
whoever has access to the machine.

Passwords are hashed the moment they are entered and the readable version is
never written to disk, never logged, and shown on screen exactly once.
"""

import argparse
import getpass
import secrets
import string
import sys

import auth


def make_password(length=20):
    """
    Build a strong random password.

    Drawn from letters, digits and a few safe symbols using `secrets`, which
    is the random generator meant for security work - unlike `random`, its
    output cannot be predicted from earlier values.
    """
    alphabet = string.ascii_letters + string.digits + "!@#$%^&*-_=+"
    return "".join(secrets.choice(alphabet) for _ in range(length))


def cmd_add(args, verb="Created"):
    username = args.username.strip().lower()

    if args.ask:
        # getpass hides the typing, so the password does not linger in the
        # terminal history or on the screen.
        try:
            first = getpass.getpass("New password: ")
            second = getpass.getpass("Type it again: ")
        except (EOFError, KeyboardInterrupt):
            print("\nCancelled - nothing was changed.")
            return 1
        if first != second:
            print("Those two did not match. Nothing was changed.")
            return 1
        password, generated = first, False
    else:
        password, generated = make_password(), True

    try:
        auth.add_user(username, password)
    except ValueError as exc:
        print(f"Could not do that: {exc}")
        return 1

    print(f"\n{verb} user '{username}'.")
    if generated:
        print("\n  Password:  " + password)
        print("\n  Copy it now - it is not stored anywhere readable and cannot")
        print("  be shown again. Run 'reset' if you lose it.")
    print(f"\nStored (hashed) in {auth.USERS_FILE}")
    return 0


def cmd_list(_args):
    users = auth.load_users()
    if not users:
        print("No users yet. Create one with:  python manage_users.py add <name>")
        print("\nUntil at least one exists the portal stays open, so you cannot")
        print("lock yourself out of a fresh install.")
        return 0
    print(f"{len(users)} user(s) in {auth.USERS_FILE}:\n")
    for name, record in sorted(users.items()):
        print(f"  {name:<20} created {record.get('created', 'unknown')}")
    return 0


def cmd_remove(args):
    name = args.username.strip().lower()
    if auth.remove_user(name):
        print(f"Removed '{name}'.")
        if not auth.any_users_exist():
            print("\nThat was the last user, so the portal is now OPEN to anyone")
            print("who can reach it. Create another account before exposing it.")
        return 0
    print(f"There is no user called '{name}'.")
    return 1


def main():
    parser = argparse.ArgumentParser(
        description="Manage who can sign in to the Momentum Backtest Portal.")
    sub = parser.add_subparsers(dest="command", required=True)

    p_add = sub.add_parser("add", help="create a user (or change their password)")
    p_add.add_argument("username")
    p_add.add_argument("--ask", action="store_true",
                       help="type the password yourself instead of generating one")

    sub.add_parser("list", help="show existing users")

    p_rm = sub.add_parser("remove", help="delete a user")
    p_rm.add_argument("username")

    p_reset = sub.add_parser("reset", help="give a user a new password")
    p_reset.add_argument("username")
    p_reset.add_argument("--ask", action="store_true")

    args = parser.parse_args()
    if args.command == "add":
        return cmd_add(args)
    if args.command == "reset":
        if args.username.strip().lower() not in auth.load_users():
            print(f"There is no user called '{args.username}'. Use 'add' to create one.")
            return 1
        return cmd_add(args, verb="Reset password for")
    if args.command == "list":
        return cmd_list(args)
    if args.command == "remove":
        return cmd_remove(args)
    return 1


if __name__ == "__main__":
    sys.exit(main())
