# fish completion for dropln
#
# Install:
#   - homebrew handles this automatically
#   - manual: cp dropln.fish ~/.config/fish/completions/

# No-op helper: dropln has no `--help` subcommand listing, so we just declare
# the verbs and flags statically.

complete -c dropln -f

# ─── Subcommands ─────────────────────────────────────────────────────────
complete -c dropln -n __fish_use_subcommand -a list   -d "List local paste history"
complete -c dropln -n __fish_use_subcommand -a delete -d "Delete a paste"
complete -c dropln -n __fish_use_subcommand -a rm     -d "Delete a paste (alias)"

# ─── Global flags ────────────────────────────────────────────────────────
complete -c dropln -l version -d "Print version"
complete -c dropln -s h -l help -d "Show help"

# ─── Create / fetch flags ────────────────────────────────────────────────
complete -c dropln -l server   -x -d "Server endpoint" \
    -a "https://dropln.com http://localhost:8080"
complete -c dropln -l expire   -x -d "Expiry window" \
    -a "5min 10min 1hour 1day 1week 1month 1year never"
complete -c dropln -l burn        -d "One-time-read paste"
complete -c dropln -l password -x -d "Password protect / decrypt"
complete -c dropln -l file     -r -d "Attach file"
complete -c dropln -l format   -x -d "Paste format" \
    -a "plaintext syntaxhighlighting markdown"
complete -c dropln -l no-discussion -d "Disable comments on this paste"
complete -c dropln -l copy        -d "Copy URL to clipboard"
complete -c dropln -l note     -x -d "Local-history note"
complete -c dropln -l quiet       -d "Print only the URL"
complete -c dropln -s q           -d "Print only the URL"

# Fetch-side
complete -c dropln -l extract -r -d "Attachment output dir"
complete -c dropln -l output  -r -d "Write paste text to file"
complete -c dropln -l no-text     -d "Skip paste text output"
complete -c dropln -l no-attachment -d "Skip attachment auto-save"
complete -c dropln -l force       -d "Overwrite existing files"

# Delete-side
complete -c dropln -n "__fish_seen_subcommand_from delete rm" \
    -l token -x -d "Delete token (otherwise from history)"
