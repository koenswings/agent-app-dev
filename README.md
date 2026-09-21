# App Dev — IDEA Platform

This is the App Dev workspace for the IDEA platform. It contains the App Harness integration test framework and is the workspace for managing IDEA App Disks.

## What are App Disks?

An App Disk is a USB/SSD drive that the Engine auto-detects when docked. It contains a `compose.yaml` and `META.yaml` that tell the Engine which Docker containers to start. App Disks are the distribution mechanism for getting educational apps into schools — no download, no internet, no installer.

## Current IDEA Apps

| App | Repo |
|-----|------|
| Kolibri (educational content) | `koenswings/app-kolibri` |
| Nextcloud (file sharing) | `koenswings/app-nextcloud` |
| Kiwix (offline Wikipedia) | `koenswings/app-kiwix` |
| MilkWise (baby milk tracker) | `koenswings/app-milkwise` |

## This repo contains

- `apps/app-harness/` — integration test framework that spawns a real Engine in testMode
- `proposals/` — past decisions and design reasoning

## Repos

| Repo | Purpose |
|------|---------|
| `koenswings/agent-app-dev` | This repo — workspace and harness |
| `koenswings/app-<name>` | Per-App repos |
| `koenswings/idea` | Org root — tasks, proposals, docs |
