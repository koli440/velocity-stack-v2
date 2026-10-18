---
id: 2026-12-09-template-syntax
date: 2026-12-09
title: Template syntax: Nx, tolerance, hours and nested groups
link: /dsl-guide
linkLabel: Open the syntax guide
---
Writing templates got easier. The **template syntax guide** has the details.

- **Optional tolerance:** `±10%` is no longer required. Left out it means ±0%.
- **Hours:** use `h` for long steps, for example `work 2h @ Z2`.
- **Optional repeat prefix:** a line like `6x` starts a repeated group, and a group can be closed with `end`.
- **Nested groups:** a repeated group can contain another group, up to 3 levels.
