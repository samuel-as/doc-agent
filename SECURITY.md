# Security Policy

## Supported versions

Only the latest release on `main` receives security fixes.

## Reporting a vulnerability

Please **do not open a public issue** for security problems. Use GitHub's private
vulnerability reporting instead: go to the repository's **Security** tab and click
**Report a vulnerability**.

Relevant context for researchers:

- The recorder runs entirely on the user's machine and sends nothing over the network
  by itself; the only downloads are the pinned Node.js runtime from `nodejs.org` and
  the npm packages compiled into the committed bundle.
- Reports about screenshots capturing sensitive on-screen data are expected behavior
  (documented in the README) unless they defeat the password-screen suppression —
  bypasses of that suppression are very much in scope.
