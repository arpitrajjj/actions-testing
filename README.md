# actions-testing

A GitHub Actions workflow that, on a **macOS** runner:

1. Boots a `macos-latest` runner.
2. Captures the macOS **home screen** (the Desktop) using the built-in `screencapture` utility.
3. Commits the PNG to this repo under [`screenshot/`](screenshot/) — **not** as a workflow artifact.

## Workflow

File: [`.github/workflows/macos-screenshot.yml`](.github/workflows/macos-screenshot.yml)

| Trigger | When it runs |
| --- | --- |
| `push` | When the workflow file itself is changed on `main` |
| `workflow_dispatch` | Manually, from the **Actions** tab → **Run workflow** |

The screenshot lands at `screenshot/macos-home.png`.

## How the screenshot is captured

```bash
osascript -e 'tell application "Finder" to activate'   # show the Desktop
screencapture -x screenshot/macos-home.png             # -x = no shutter sound
```

The upload uses the workflow's `GITHUB_TOKEN` (with `permissions: contents: write`)
and a plain `git push` — so the image always lives in the repository, viewable on
GitHub.

## Manual run

1. Open the **Actions** tab.
2. Select **macOS home screen screenshot**.
3. Click **Run workflow** → **Run workflow** on `main`.
