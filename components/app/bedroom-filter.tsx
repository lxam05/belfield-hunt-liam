import { bedroomOptions } from "@/lib/bedroom-filter";

export function BedroomFilter({
  selected,
  onChange,
}: {
  selected: readonly number[];
  onChange: (counts: number[]) => void;
}) {
  return (
    <fieldset className="my-2 flex flex-wrap items-center gap-2">
      <legend className="mb-1 font-medium">Bedrooms</legend>
      {bedroomOptions.map((n) => (
        <label key={n} className="flex cursor-pointer items-center gap-1 rounded border px-2 py-1">
          <input
            type="checkbox"
            checked={selected.includes(n)}
            aria-label={n + " bedrooms"}
            onChange={() =>
              onChange(
                bedroomOptions.filter((b) =>
                  b === n ? !selected.includes(b) : selected.includes(b),
                ),
              )
            }
          />
          {n}
        </label>
      ))}
    </fieldset>
  );
}
