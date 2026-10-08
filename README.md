# prompt-cats

A Claude Code mod: two pixel cats on a thin ground line, just above the prompt, on the right.

- **Idle:** they sit, now and then blinking or flicking a tail.
- **While Claude works:** they walk in place until the reply is done.

The left cat is a bright golden British Shorthair, the right one a browner tabby.

## Install

Type this at the prompt in Claude Code:

```
/plugin install prompt-cats --marketplace Harvey1311/claude-code-mods-cat
```

Answer `y` to add the marketplace, then pick the **user** scope so the cats appear in every session.

## Update

```
/plugin marketplace update claude-code-mods-cat
```

## Notes

- Built on Claude Code's function-hooks plugin API, which is marked early access: a Claude Code update
  can change it.
- Works in any terminal. The cats are drawn with half-block characters, so no image support is needed.
- macOS Terminal.app draws block characters from its font, slightly short of a full line, which leaves a
  thin dark line between rows of the cats. There, and only there, the cats are drawn differently: the
  belly is solid fur color, and a dark fill goes under any belly dot without a leg beneath it. The fill
  is tuned for the "Clear Dark" profile; on a lighter or see-through background it shows as a
  small dark patch between the legs. Other terminals (VS Code, iTerm2, Ghostty, ...) are unaffected.
- The cats take 3 rows above the prompt and hide while a survey is shown or when the terminal is
  narrower than 28 columns.
