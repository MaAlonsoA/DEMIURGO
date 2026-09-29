// Typed catalogs of the interface's words. Each area of the app declares its messages once in
// English (the source, the product's words as they have always been) and once in Spanish, with the
// same keys and the same signatures: a missing or extra key doesn't compile. A message is a string
// or a function for plurals and values.

import { type Locale, useLocale, useReadingLocale } from './locale.ts';

export type Message = string | ((...args: never[]) => string);

/** The Spanish side must have exactly the English keys, with the same kind of value. */
export type Translation<E extends Record<string, Message>> = {
  [K in keyof E]: E[K] extends string ? string : E[K];
};

export type Catalog<E extends Record<string, Message>> = Readonly<Record<Locale, Translation<E>>>;

export function messages<E extends Record<string, Message>>(en: E, es: Translation<E>): Catalog<E> {
  return { en: en as Translation<E>, es };
}

/** The area's messages in the language shown now. */
export function useMessages<E extends Record<string, Message>>(catalog: Catalog<E>): Translation<E> {
  return catalog[useLocale()];
}

/** The area's messages in the language the content is read in: for texts sent as the person's words. */
export function useContentMessages<E extends Record<string, Message>>(catalog: Catalog<E>): Translation<E> {
  return catalog[useReadingLocale()];
}
