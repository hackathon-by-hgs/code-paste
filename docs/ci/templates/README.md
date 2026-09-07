# CI templates for domains not yet created

`shared` and `desktop` are listed in `DEV_GUIDE.md` §2 but have no commits yet. When someone
bootstraps one of those orphan branches (DEV_GUIDE.md §10), copy the matching template into the new
branch's `.github/workflows/` and adjust it to the chosen stack.

| File | For | Notes |
|---|---|---|
| `shared-ci.yml` | `shared` | TypeScript protocol/domain types published as a pinned git-tag dependency. |
| `desktop-ci.yml` | `desktop` | OS clipboard agent. Stack TBD (ADR-002). Template shows a Node/TS shape; adapt for Rust/Go if chosen. |
| `DOMAIN_pull_request_template.md` | any | Generic PR template; drop in as `.github/pull_request_template.md`. |
| `DOMAIN_CODEOWNERS` | any | Generic CODEOWNERS; drop in as `.github/CODEOWNERS`. |

After adding CI to a new branch:

1. Add its required-check contexts to a new `.github/rulesets/<domain>.json` on `main`
   (copy `frontend.json`, swap the branch name and the `required_status_checks` contexts to match
   the new workflow's job names).
2. Re-run `scripts/apply-rulesets.sh`.
3. Uncomment the branch's Dependabot entry in `.github/dependabot.yml`.
4. Record the stack decision as an ADR in `docs/`.
