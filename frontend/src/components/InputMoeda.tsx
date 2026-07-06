import { NumericFormat } from 'react-number-format';

const inputStyle: React.CSSProperties = {
  background: 'var(--surface-2)', border: '1px solid var(--border)', borderRadius: 10,
  padding: '8px 12px', color: 'var(--text-1)', fontSize: 14, outline: 'none', width: '100%',
};

interface InputMoedaProps {
  value: number | null | undefined;
  onChange: (v: number | null) => void;
  disabled?: boolean;
  style?: React.CSSProperties;
}

/**
 * Input de moeda BR com edição livre (NumericFormat).
 * `value` é o número de reais (ex.: 800000 = R$ 800.000,00) ou null/undefined para vazio.
 * `onChange` entrega o floatValue (number) ou null quando o campo é apagado.
 */
export function InputMoeda({ value, onChange, disabled, style }: InputMoedaProps) {
  return (
    <NumericFormat
      value={value ?? ''}
      thousandSeparator="."
      decimalSeparator=","
      decimalScale={2}
      fixedDecimalScale
      prefix="R$ "
      placeholder="R$ 0,00"
      allowNegative={false}
      onValueChange={({ floatValue }) => onChange(floatValue ?? null)}
      disabled={disabled}
      style={{ ...inputStyle, ...style }}
    />
  );
}
