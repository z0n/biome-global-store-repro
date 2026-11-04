import { useState } from 'react';

export function useExample() {
  const [text] = useState<string>('hello');
  return [
    text.toString(), // Must report: state is already a string.
    'hello'.toString(), // Positive control: must report.
    (42).toString(), // Negative control: must not report.
  ];
}
