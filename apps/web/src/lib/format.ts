import { useMemo } from 'react'
import { usePreferences } from './preferences'

export function useFormat() {
  const { locale, digits } = usePreferences().preferences

  return useMemo(() => {
    const tag = `${locale}-EG-u-nu-${digits === 'arabic' ? 'arab' : 'latn'}`
    const number = new Intl.NumberFormat(tag)
    const dateTime = new Intl.DateTimeFormat(tag, { dateStyle: 'medium', timeStyle: 'short' })

    return {
      number: (value: number) => number.format(value),
      dateTime: (value: number) => dateTime.format(value),
      bytes(value: number) {
        const unit = value >= 1024 * 1024 ? 'megabyte' : 'kilobyte'
        const divisor = unit === 'megabyte' ? 1024 * 1024 : 1024
        return new Intl.NumberFormat(tag, {
          style: 'unit',
          unit,
          maximumFractionDigits: 1,
        }).format(value / divisor)
      },
    }
  }, [digits, locale])
}
