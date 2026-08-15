# codecrypt 🔐📦

> A personal vault of stable, working project builds — zipped, archived, and preserved as `.tar.gz` snapshots.

---

## Table of Contents

- [Overview](#overview)
- [How It Works](#how-it-works)
- [Repository Structure](#repository-structure)
- [Project Index](#project-index)
- [How to Extract an Archive](#how-to-extract-an-archive)
- [Why tar.gz Over Just Zip?](#why-targz-over-just-zip)
- [Verifying Archive Integrity](#verifying-archive-integrity)
- [Versioning Convention](#versioning-convention)
- [Status & Contributing](#status--contributing)
- [License](#license)

---

## Overview

**codecrypt** is a personal archive for source code of projects I've built, care about, and consider stable and working at the point of archiving. It's not a live development repo — it's a **snapshot vault**. Each entry represents a project in a known-good state, preserved so it can be pulled out, extracted, and run (or referenced) at any point in the future without depending on live services, changing dependencies, or my own memory of "how did I build this again?"

Think of it as cold storage for code I don't want to lose.

---

## How It Works

Each project goes through a simple two-stage compression pipeline before being committed:

1. **Zip** — the working project folder is first zipped as a clean, self-contained snapshot.
2. **Tar.gz** — the zip is then wrapped/converted into a `.tar.gz` archive for final storage in this repo.

The result: every archived project lives here as a single `.tar.gz` file, named and versioned consistently (see [Versioning Convention](#versioning-convention)).

---

## Repository Structure

```
codecrypt/
├── README.md
├── project-name-a/
│   ├── project-name-a-v1.0.tar.gz
│   └── project-name-a-v1.1.tar.gz
├── project-name-b/
│   └── project-name-b-v1.0.tar.gz
└── ...
```

- Each project gets its **own folder**, named after the project.
- Multiple versions of the same project can coexist in that folder — nothing gets overwritten.
- The archive filename always includes the version number, so you never have to open a file to know what's inside.

---

## Project Index

A running log of everything archived here. Update this table every time a new project (or version) is added.

| Project | Description | Stack | Version | Archived On |
|---|---|---|---|---|
| _example-project_ | _Short one-line description_ | _Node.js, PostgreSQL_ | _v1.0_ | _2026-08-15_ |

---

## How to Extract an Archive

```bash
# Extract a tar.gz archive
tar -xzvf project-name-v1.0.tar.gz

# If the archive contains a nested zip instead of raw files
unzip project-name-v1.0.zip
```

Flags explained:
- `-x` extract
- `-z` decompress gzip
- `-v` verbose (shows files as they're extracted)
- `-f` specify the filename

---

## Why tar.gz Over Just Zip?

- **Better compression** for source code (lots of small text files) compared to zip in most cases.
- **Preserves Unix file permissions and symlinks**, which zip doesn't always handle well.
- **Single-stream format** — plays nicer with Git and command-line tooling on Linux/macOS.
- Zip is still used as the *first* packaging step since it's a fast, universal way to bundle a folder before final compression.

---

## Verifying Archive Integrity

Optional but recommended — generate a checksum when archiving, and store it alongside the file (or in the Project Index table) so you can confirm nothing got corrupted later:

```bash
# Generate a checksum
sha256sum project-name-v1.0.tar.gz > project-name-v1.0.tar.gz.sha256

# Verify later
sha256sum -c project-name-v1.0.tar.gz.sha256
```

---

## Versioning Convention

```
<project-name>-v<major>.<minor>.tar.gz
```

- **major** — bumped for significant rewrites or breaking changes to the project
- **minor** — bumped for small updates, fixes, or incremental improvements
- Always increment when re-archiving — never overwrite a previous version's file

---

## Status & Contributing

This is a **personal archive**, not an actively developed open-source project. It's not accepting pull requests or issues, but feel free to fork it if the structure is useful for your own archival system.

---

## License

Unless a specific project folder states otherwise, all archived code here is © Boniface and shared for reference/archival purposes only. Check individual project archives for their own licensing if you plan to reuse the code.

---

<sub>Last updated: 2026-08-15</sub>
