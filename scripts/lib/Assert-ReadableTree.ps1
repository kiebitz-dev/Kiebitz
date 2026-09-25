# Prüft vor einem Build, ob sich die Ordner des Repos lesen lassen.
#
# Das Repo liegt in einem Nextcloud-Ordner mit virtuellen Dateien. Nextcloud
# lagert dort Ordner aus, die länger nicht benutzt wurden (am 25.09.2026 z. B.
# `artifacts`, `src\lib` und `src-tauri\gen\android\app`). Solange der
# Nextcloud-Client läuft, fällt das nicht auf: Windows holt einen Ordner beim
# ersten Zugriff zurück. Läuft er nicht, kann Windows ausgelagerte Ordner
# weder auflisten noch darin nach einer Datei suchen. Einzelne bekannte
# Dateien öffnen sich trotzdem, deshalb kommt der Build weit und scheitert
# erst mitten drin. Beim Release v1.6.3 war das clang im Stockfish-Build:
#
#     memory.cpp:24:19: fatal error: cannot open file './features.h': Unknown error
#
# `__has_include("features.h")` sucht in `src\` nach einer Datei, die es
# nicht gibt, und genau diese Frage kann ohne Cloud-Anbieter niemand
# beantworten. Diese Prüfung stellt dieselbe Frage vorher für jeden Ordner und
# sagt, woran es liegt.

function Assert-ReadableTree {
    param(
        [Parameter(Mandatory)] [string]$Root,
        [string[]]$Paths = @("."),
        # Groß und nicht Teil des Nextcloud-Abgleichs, oder vom Werkzeug selbst verwaltet.
        [string[]]$Skip = @("node_modules", "target", ".git", ".gradle", "build")
    )

    $stack = New-Object System.Collections.Generic.Stack[string]
    foreach ($path in $Paths) {
        $full = Join-Path $Root $path
        if (Test-Path -LiteralPath $full) {
            $stack.Push($full)
        }
    }

    while ($stack.Count -gt 0) {
        $directory = $stack.Pop()
        try {
            $children = Get-ChildItem -LiteralPath $directory -Directory -Force -ErrorAction Stop
        } catch {
            $relative = $directory.Substring($Root.Length).TrimStart("\")
            if (-not $relative) { $relative = "." }
            $running = @(Get-Process -ErrorAction SilentlyContinue | Where-Object { $_.ProcessName -eq "nextcloud" }).Count -gt 0
            $hint = if ($running) {
                "Der Nextcloud-Client läuft, konnte den Ordner aber nicht liefern. Nextcloud-Status prüfen und erneut versuchen."
            } else {
                "Der Nextcloud-Client läuft nicht. Nextcloud starten, abwarten, bis er verbunden ist, und erneut versuchen."
            }
            throw "Ordner nicht lesbar: $relative ($($_.Exception.Message.Trim())) · Der Ordner ist vermutlich von Nextcloud ausgelagert. $hint"
        }
        foreach ($child in $children) {
            if ($Skip -notcontains $child.Name) {
                $stack.Push($child.FullName)
            }
        }
    }
}
