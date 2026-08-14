# Security Policy

## Supported versions

The latest version published to npm is the only one that gets fixes.

## Reporting a vulnerability

Please **don't** open a public issue for a security problem.

Use GitHub's [private vulnerability reporting](https://github.com/Booyaka101/pal-schema-collect/security/advisories/new) instead. Expect a first response within a week.

Please include what you found, how to reproduce it, and what an attacker gets out of it.

## What this touches

Reads your local Schema Generator output and, with `--submit`, opens a pull request against the public registry using the token you supply.

- **`--submit` uses a GitHub token you supply** to open a pull request against the registry. It needs no more than public-repo write on a fork. It is read from `--token` or the environment, never written to disk.
- **Schema files are read from your disk and published publicly** in that pull request. Check what is in the directory before you submit it.

## Scope

In scope: anything that leaks a credential, reads data belonging to someone else, or lets untrusted input reach code execution.

Out of scope: findings that require an attacker to already control the machine it runs on.
