# ADR 0001: Technology stack

## Status

Accepted

## Date

<YYYY-MM-DD>

## Context

<requirements-and-constraints>

## Options
| option | pros | cons | better when | component reuse | source |
| --- | --- | --- | --- | --- | --- |
| Next.js + shadcn/ui | Integrated React application stack | Framework conventions add coupling | Routing and server seams belong together | Registry components remain source-owned | https://nextjs.org/docs |
| Vite + React | Focused client toolchain | Backend requires a separate choice | Client and service deploy independently | React components move between applications | https://vite.dev/guide |

## Ruling

<YYYY-MM-DD>: <selected-option> — <reason>

## Consequences

<positive-and-negative-consequences>

## Revisit when

<measurable-revisit-condition>
