#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

commit_message="${*:-}"
release_repo="${RELEASE_REPO:-anishthite/makerspace-downloads}"

current_tag() {
  node -p '"v" + require("./package.json").version'
}

commit_if_dirty() {
  local message="$1"
  if [[ -z "$(git status --porcelain)" ]]; then
    return 0
  fi
  git add -A
  git commit -m "$message"
}

if [[ -n "$(git status --porcelain)" ]]; then
  if [[ -z "$commit_message" ]]; then
    echo "Git has uncommitted changes; they will not be pushed unless committed:" >&2
    git status --short >&2
    echo >&2
    echo 'Commit them first, or pass a commit message:' >&2
    echo '  npm run release:push -- "Commit message"' >&2
    exit 1
  fi

  commit_if_dirty "$commit_message"
fi

git fetch --quiet --tags origin || true
tag="$(current_tag)"
if git rev-parse -q --verify "refs/tags/$tag" >/dev/null 2>&1; then
  if [[ "$(git rev-list -n 1 "$tag")" == "$(git rev-parse HEAD)" ]]; then
    echo "$tag already tags HEAD; reusing it."
  else
    echo "$tag already exists; bumping patch."
    npm version patch --no-git-tag-version
    tag="$(current_tag)"
  fi
fi
title="Spanner $tag"
commit_if_dirty "Prepare $tag release"

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

assets=(output/desktop-package/spanner.dmg)
for zip in output/desktop-package/spanner-mac-*.zip; do
  [[ -f "$zip" ]] && assets+=("$zip")
done

if gh release view "$tag" -R "$release_repo" >/dev/null 2>&1; then
  gh release upload "$tag" -R "$release_repo" "${assets[@]}" --clobber
else
  gh release create "$tag" -R "$release_repo" "${assets[@]}" --title "$title" --notes "Notarized macOS desktop release."
fi

echo "published https://github.com/$release_repo/releases/tag/$tag"
