import { z } from 'zod';

// The inputs of the tools. Every field is capped, every object is strict: a field that is not
// listed is refused, not ignored. There is no field that opens the private network, and no file
// name: text that would be a file is passed as `text`.

/** Longest address accepted. */
export const URL_MAX = 2048;
/** Longest robots.txt text accepted (the 500 KiB the reader would read anyway). */
export const ROBOTS_TEXT_MAX = 500 * 1024;
/** Longest llms.txt text accepted (the 1 MiB the reader would read anyway). */
export const LLMS_TEXT_MAX = 1024 * 1024;
export const PAGES_DEFAULT = 30;
export const PAGES_MAX = 100;
const PATH_MAX = 2048;

// Spaces and control characters are not part of an address; a person's typo is refused here.
// eslint-disable-next-line no-control-regex
const NOT_ADDRESS = /[\u0000-\u0020\u007f-\u009f]/;

// A path: starts with "/", no space and no control character.
// eslint-disable-next-line no-control-regex
const PATH_PATTERN = /^\/[^\u0000-\u0020\u007f-\u009f]*$/;

const WEB_PREFIX = /^https?:\/\/[^/\\?#]/i;

/** An http or https address, and nothing else: no other scheme, no bare host name. */
export function isWebAddress(value: string): boolean {
  // The scheme is followed by two slashes and a host: `http:example.com` is not an address.
  if (value.length > URL_MAX || NOT_ADDRESS.test(value) || !WEB_PREFIX.test(value)) return false;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return false;
  }
  return (url.protocol === 'http:' || url.protocol === 'https:') && url.hostname !== '';
}

const webAddress = z
  .string()
  .min(8)
  .max(URL_MAX)
  .refine(isWebAddress, 'Give an http or https address, such as https://example.com.')
  .describe('The site address: http or https, such as https://example.com');

const failOn = z
  .enum(['fail', 'warn'])
  .optional()
  .describe('Which level of finding sets exitCode to 1: "fail" (default) or "warn".');

const exactlyOne = (value: { url?: string | undefined; text?: string | undefined }): boolean =>
  (value.url === undefined) !== (value.text === undefined);
const EXACTLY_ONE = 'Give either url or text, not both and not neither.';

export const checkInput = z.strictObject({ url: webAddress, failOn });

export const robotsTestInput = z
  .strictObject({
    url: webAddress
      .optional()
      .describe('The site whose /robots.txt is tested (or the address of a robots.txt).'),
    text: z
      .string()
      .min(1)
      .max(ROBOTS_TEXT_MAX)
      .optional()
      .describe('The text of a robots.txt, tested without any request.'),
    agent: z
      .string()
      .regex(/^[A-Za-z0-9*][A-Za-z0-9._*-]{0,63}$/, 'A crawler token such as OAI-SearchBot.')
      .optional()
      .describe(
        'One crawler token, such as OAI-SearchBot. Without it every covered crawler is tested.',
      ),
    path: z
      .string()
      .max(PATH_MAX)
      .regex(PATH_PATTERN, 'Starts with "/", no spaces or control characters.')
      .optional()
      .describe('The path to test, starting with "/". Default "/".'),
    failOn,
  })
  .refine(exactlyOne, EXACTLY_ONE);

export const llmsValidateInput = z
  .strictObject({
    url: webAddress
      .optional()
      .describe('The site whose /llms.txt is validated (or the address of an llms.txt).'),
    text: z
      .string()
      .min(1)
      .max(LLMS_TEXT_MAX)
      .optional()
      .describe('The text of an llms.txt, validated without any request.'),
    links: z
      .boolean()
      .optional()
      .describe("Also request up to 20 of the file's links. With text, base is needed."),
    base: webAddress
      .optional()
      .describe('The site address that relative links in text resolve against.'),
    failOn,
  })
  .refine(exactlyOne, EXACTLY_ONE)
  .refine(
    (value) => value.links !== true || value.text === undefined || value.base !== undefined,
    'links on text needs base, the site address the links resolve against.',
  );

export const llmsGenerateInput = z.strictObject({
  url: webAddress,
  maxPages: z
    .number()
    .int()
    .min(1)
    .max(PAGES_MAX)
    .optional()
    .describe(`Pages to list, 1 to ${PAGES_MAX}. Default ${PAGES_DEFAULT}.`),
});

export const crawlersInput = z.strictObject({});
