#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

commit_message="${*:-}"
release_repo="${RELEASE_REPO:-anishthite/makerspace-downloads}"
tag="v$(node -p "require('./package.json').version")"
title="Makerspace $tag"

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ -z "$commit_message" ]]; then
    echo "Git has uncommitted changes; they will not be pushed unless committed:" >&2
    git status --short >&2
    echo >&2
    echo 'Commit them first, or pass a commit message:' >&2
    echo '  npm run release:push -- "Commit message"' >&2
    exit 1
  fi

  git add -A
  git commit -m "$commit_message"
fi

npm run desktop:release

if [[ -n "$(git status --porcelain)" ]]; then
  echo "Release built, but git now has uncommitted changes:" >&2
  git status --short >&2
  exit 1
fi

if git rev-parse --abbrev-ref --symbolic-full-name '@{u}' >/dev/null 2>&1; then
  git push
else
  branch="$(git branch --show-current)"
  if [[ -z "$branch" ]]; then
    echo "Not on a branch; push manually." >&2
    exit 1
  fi
  git push -u origin "$branch"
fi

if git rev-parse "$tag" >/dev/null 2>&1; then
  if [[ "$(git rev-list -n 1 "$tag")" != "$(git rev-parse HEAD)" ]]; then
    echo "$tag already exists on a different commit. Bump package.json for a new release." >&2
    exit 1
  fi
else
  git tag -a "$tag" -m "$title"
fi
git push origin "$tag"

assets=(output/desktop-package/makerspace.dmg)
for zip in output/desktop-package/makerspace-mac-*.zip; do
  [[ -f "$zip" ]] && assets+=("$zip")
done

if gh release view "$tag" -R "$release_repo" >/dev/null 2>&1; then
  gh release upload "$tag" -R "$release_repo" "${assets[@]}" --clobber
else
  gh release create "$tag" -R "$release_repo" "${assets[@]}" --title "$title" --notes "Notarized macOS desktop release."
fi

echo "published https://github.com/$release_repo/releases/tag/$tag"
