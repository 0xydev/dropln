# bash completion for dropln
#
# Install:
#   - homebrew handles this automatically (see Brewfile)
#   - manual:  cp dropln.bash /etc/bash_completion.d/dropln
#   - per-user: . ./dropln.bash  (or source from ~/.bashrc)

_dropln() {
    local cur prev words cword
    _init_completion || return

    # Subcommands as the first positional after the binary.
    local subcmds="list delete rm"
    local create_flags="--server --expire --burn --password --file --format --no-discussion --copy --note --quiet -q"
    local fetch_flags="--server --extract --output --no-text --no-attachment --force --password"
    local delete_flags="--token"
    local global_flags="--version --help -h"

    # Per-flag value completion.
    case "$prev" in
        --expire)
            COMPREPLY=( $(compgen -W "5min 10min 1hour 1day 1week 1month 1year never" -- "$cur") )
            return
            ;;
        --format)
            COMPREPLY=( $(compgen -W "plaintext syntaxhighlighting markdown" -- "$cur") )
            return
            ;;
        --file|--output|--extract)
            _filedir
            return
            ;;
        --server)
            COMPREPLY=( $(compgen -W "https://dropln.com http://localhost:8080" -- "$cur") )
            return
            ;;
    esac

    # First positional: subcommand or flag.
    if [[ $cword -eq 1 ]]; then
        COMPREPLY=( $(compgen -W "$subcmds $create_flags $fetch_flags $global_flags" -- "$cur") )
        return
    fi

    # After `delete`/`rm`: complete delete-specific flags.
    case "${words[1]}" in
        delete|rm)
            COMPREPLY=( $(compgen -W "$delete_flags $global_flags" -- "$cur") )
            return
            ;;
        list)
            COMPREPLY=( $(compgen -W "$global_flags" -- "$cur") )
            return
            ;;
    esac

    # Default: any flag.
    COMPREPLY=( $(compgen -W "$create_flags $fetch_flags $global_flags" -- "$cur") )
}

complete -F _dropln dropln
