"use client";

import { useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

// A small chip/tag editor: type a value, press Enter or comma to add it, click
// the × (or Backspace on an empty field) to remove. Used by the Goals editor
// for target companies / roles / locations.
export function TagInput({
  label,
  values,
  onChange,
  placeholder,
  id,
}: {
  label: string;
  values: string[];
  onChange: (next: string[]) => void;
  placeholder?: string;
  id: string;
}) {
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const v = raw.trim();
    if (!v) return;
    if (!values.some((x) => x.toLowerCase() === v.toLowerCase())) {
      onChange([...values, v]);
    }
    setDraft("");
  }

  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-foreground">
        {label}
      </label>
      {values.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {values.map((v) => (
            <Badge key={v} variant="secondary" className="gap-1 pr-1">
              {v}
              <button
                type="button"
                aria-label={`Remove ${v}`}
                onClick={() => onChange(values.filter((x) => x !== v))}
                className="rounded-full px-1 text-sm leading-none text-muted-foreground transition-colors hover:text-foreground"
              >
                <span aria-hidden>×</span>
              </button>
            </Badge>
          ))}
        </div>
      )}
      <Input
        id={id}
        value={draft}
        placeholder={placeholder}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            add(draft);
          } else if (e.key === "Backspace" && !draft && values.length) {
            onChange(values.slice(0, -1));
          }
        }}
        onBlur={() => add(draft)}
      />
    </div>
  );
}
