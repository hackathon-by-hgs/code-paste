# Product Principles

## The product should feel like magic

The user should think:

> "I copied it on my laptop and it was already on my phone."

Not:

> "I configured a local network clipboard synchronization protocol."

## Default journey

```text
Install
  |
Login
  |
Allow required permissions
  |
Done
```

After setup:

```text
Copy
  |
Automatic sync
  |
Paste
```

## Sharing journey

```text
Open Share
   |
Create session
   |
Other authorized user joins
   |
Copy
   |
Everyone in session receives it
```

## UX constraints

Avoid:
- IP addresses.
- ports.
- QR codes unless genuinely useful for pairing.
- terminal commands for ordinary users.
- manual API keys.
- network configuration.
- confusing technical statuses.

## Safety UX

The UI should always answer:

1. Is sync on?
2. Which devices can receive my clipboard?
3. Am I currently sharing?
4. How do I stop it?

## The lazy-user test

For every feature ask:

> Can this be one tap?

If yes, make it one tap.

If no, ask:

> Can the app infer it safely?

If yes, infer it.

If no, make the required decision clear and explain why.
