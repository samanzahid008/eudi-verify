# WordPress Integration

Add the `<eudi-verify>` widget to a WordPress site by hand — enqueue the
script, drop the element into a page, and point it at a verifier endpoint.

> **No plugin ships today.** This is a manual-embed path: you edit your theme
> (or a child theme) directly. A dedicated WordPress plugin is on the
> [roadmap](https://github.com/eudi-verify/eudi-verify/blob/main/docs/SUPPORTED.md#framework-integrations)
> but not built yet — don't expect a "EUDI Verify" entry in Plugins → Add New.

**Prerequisites:** a running verifier API. WordPress is a PHP application, so
the backend half of this is already covered in
[php.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/php.md) —
this guide only covers the WordPress-specific frontend wiring and links to
php.md for the server side rather than repeating it.

---

## Step 1: Enqueue `@eudi-verify/embed`

`@eudi-verify/embed` is an ES module. Enqueue it from your theme's
`functions.php` (or a child theme's, so it survives theme updates) — do not
paste a `<script type="module">` tag straight into a template; WordPress's
asset pipeline expects scripts to be registered.

If you don't have a build step pulling the package from npm, load it from a
CDN such as unpkg:

### WordPress 6.5+: `wp_enqueue_script_module()`

WordPress 6.5 added native support for ES module scripts. Use it — it handles
the `type="module"` attribute and dependency graph correctly:

```php
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_script_module(
        'eudi-verify-embed',
        'https://unpkg.com/@eudi-verify/embed@1.5.0',
        array(),
        '1.5.0'
    );
} );
```

### Older than 6.5: `script_loader_tag` filter

`wp_enqueue_script_module()` doesn't exist before 6.5, and plain
`wp_enqueue_script()` has no way to mark a script as a module — WordPress will
emit a regular `<script src="...">` tag, which the browser will refuse to run
as an import. Register the script normally, then filter its tag to add
`type="module"`:

```php
add_action( 'wp_enqueue_scripts', function () {
    wp_enqueue_script(
        'eudi-verify-embed',
        'https://unpkg.com/@eudi-verify/embed@1.5.0',
        array(),
        '1.5.0',
        true // load in footer
    );
} );

add_filter( 'script_loader_tag', function ( $tag, $handle ) {
    if ( 'eudi-verify-embed' !== $handle ) {
        return $tag;
    }
    // Swap text/javascript for module so the browser treats it as an ES module
    // instead of rejecting the bare "@eudi-verify/embed" import.
    return str_replace( ' src', ' type="module" src', $tag );
}, 10, 2 );
```

Check your minimum supported WordPress version before picking a path — if you
support anything pre-6.5, use the filter version; it works on both old and new.

---

## Step 2: Place `<eudi-verify>` on the page

Custom elements don't survive the block editor's content sanitization if
typed directly into a paragraph block, so use one of these instead:

### Option A: Shortcode

Register a shortcode and drop `[eudi_verify]` into any post, page, or
widget area:

```php
add_shortcode( 'eudi_verify', function ( $atts ) {
    $atts = shortcode_atts( array(
        'api-url' => '/wp-json/eudi-verify/v1/proxy', // see Step 3
        'request' => '{"age_over_18": true}',
    ), $atts );

    return sprintf(
        '<eudi-verify api-url="%s" request=\'%s\'></eudi-verify>',
        esc_attr( $atts['api-url'] ),
        esc_attr( $atts['request'] )
    );
} );
```

```
[eudi_verify api-url="/wp-json/eudi-verify/v1/proxy" request='{"age_over_18": true}']
```

### Option B: Custom HTML block

If you'd rather not add a shortcode, paste the element straight into a
**Custom HTML** block in the block editor (this block skips the sanitizer
that strips unknown elements from rich-text blocks):

```html
<eudi-verify
  api-url="/wp-json/eudi-verify/v1/proxy"
  request='{"age_over_18": true}'
></eudi-verify>
```

Either way, wire up `verified` / `rejected` listeners the same way as any
other embed — see [integration-frontend.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/integration-frontend.md#option-a-widget-simplest)
for the event contract and attributes (`api-url`, `request`, `auto-start`) and
theming variables. Nothing about those is WordPress-specific.

---

## Step 3: Point the widget at a verifier endpoint

`api-url` has to resolve to a running verifier backend. Since your PHP app
*is* WordPress, both hosting shapes from php.md apply directly — pick based on
whether you can run a Node process alongside WordPress.

### Shape 1: Node verifier running as a separate service

If you can run `@eudi-verify/server` as a sidecar (or it's already hosted
elsewhere, e.g. a separate app server), proxy requests from WordPress to it
rather than pointing the browser straight at the Node service. A WordPress
REST API route is a natural place for this proxy:

```php
add_action( 'rest_api_init', function () {
    register_rest_route( 'eudi-verify/v1', '/proxy(?:/(?P<path>.*))?', array(
        'methods'             => array( 'GET', 'POST' ),
        'callback'            => 'eudi_verify_proxy_request',
        'permission_callback' => '__return_true',
    ) );
} );
```

The proxy body itself is the same forward-to-`EUDI_NODE_URL` logic as the PHP
proxy route in
[php.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/php.md#step-2-add-a-php-proxy-route) —
including blocking public `POST /tokens/verify` and keeping `TOKEN_SECRET` off
the browser. Adapt that route's cURL forwarding into the REST callback rather
than duplicating it here.

Validate the token server-side the same way: call `verifyEudiToken()` from
your checkout/gating handler (a form submission handler, an AJAX action, etc.)
against `EUDI_NODE_URL` — this is the same `POST /tokens/verify` flow
documented in
[php.md's Token verification section](https://github.com/eudi-verify/eudi-verify/blob/main/docs/php.md#token-verification-captcha-pattern).
Don't call it from PHP running in the browser's request — it must be a
server-side WordPress hook.

### Shape 2: WP host that cannot run Node

Shared hosting and many managed WordPress hosts can't run a Node process at
all. Two options:

- **Point at an externally-hosted Node verifier.** If you can run
  `@eudi-verify/server` on *any* host you control (a small VPS, a serverless
  Node function, etc.), WordPress doesn't need to run it — only proxy or
  reach it over HTTPS. The REST proxy route above still applies; only
  `EUDI_NODE_URL` changes to point off-box.
- **Implement the OpenAPI contract directly in PHP.** This is Path B in
  php.md: no Node anywhere; WordPress implements
  `POST /tokens/verify` and the other verifier endpoints itself, including
  OpenID4VP. See
  [php.md's Path B](https://github.com/eudi-verify/eudi-verify/blob/main/docs/php.md#path-b-implement-endpoints-from-openapi)
  for what's involved — it's a significant undertaking with no pre-built
  library, so only choose this when a Node process is genuinely off the table.

---

## Next steps

- [php.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/php.md) — backend paths, token verification, proxy route detail
- [integration-frontend.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/integration-frontend.md) — widget attributes, events, theming (framework-agnostic)
- [SUPPORTED.md](https://github.com/eudi-verify/eudi-verify/blob/main/docs/SUPPORTED.md) — full platform support matrix
- WordPress plugin — [roadmap](https://github.com/eudi-verify/eudi-verify/blob/main/docs/SUPPORTED.md#framework-integrations), not this guide
