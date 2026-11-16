# Security

Pele filters links and styles and limits source and output size.

## Reporting a vulnerability

Report a security problem privately through [GitHub](https://github.com/obsidianmd/pele/security/advisories/new), not in a public issue.

Please report diagrams that bypass URL filtering, inject scripts or HTML, or take unreasonably long to render at the default limits.

## Handling untrusted diagrams

- Display errors with `textContent`. Error messages can contain text from the diagram.
- Supply icons from a set you trust. Pele reads icon markup into the scene without filtering its paints.
- Handle internal links as note names. Their values are not filtered as URLs.
- Keep control of `options` and `options.config`. Do not let diagram authors supply them directly.
- Images can make network requests when displayed. Pass `links: false` and `images: false` to disable links and images.
- For a time limit, draw in a worker that your app can terminate.
