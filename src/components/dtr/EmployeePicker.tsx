// Searchable employee picker (combobox).
// Type to filter by name or employee number.
import { useState, useMemo } from "react";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { Employee } from "@/lib/dtr";

export function EmployeePicker({
  employees,
  value,
  onChange,
  placeholder = "Search by name or no.",
}: {
  employees: Employee[];
  value: string;
  onChange: (empNo: string) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selected = useMemo(
    () => employees.find((e) => e.empNo === value),
    [employees, value],
  );

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const sorted = [...employees].sort((a, b) =>
      a.empNo.localeCompare(b.empNo, undefined, { numeric: true }),
    );
    if (!needle) return sorted.slice(0, 200);
    return sorted
      .filter(
        (e) =>
          e.name.toLowerCase().includes(needle) ||
          e.empNo.toLowerCase().includes(needle),
      )
      .slice(0, 200);
  }, [employees, q]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
        >
          <span className="truncate text-left">
            {selected ? `#${selected.empNo} — ${selected.name}` : "Select employee"}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <div className="p-2 border-b">
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <Input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder={placeholder}
              className="pl-8 h-9"
            />
          </div>
        </div>
        <div className="max-h-[280px] overflow-auto py-1">
          {filtered.length === 0 ? (
            <div className="px-3 py-4 text-sm text-muted-foreground text-center">
              No matches.
            </div>
          ) : (
            filtered.map((e) => {
              const active = e.empNo === value;
              return (
                <button
                  type="button"
                  key={e.empNo}
                  onClick={() => {
                    onChange(e.empNo);
                    setOpen(false);
                    setQ("");
                  }}
                  className={cn(
                    "w-full text-left px-3 py-2 text-sm flex items-center gap-2 hover:bg-accent",
                    active && "bg-accent",
                  )}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 shrink-0",
                      active ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span className="truncate">
                    <span className="font-medium">#{e.empNo}</span>
                    <span className="text-muted-foreground"> — </span>
                    {e.name}
                  </span>
                </button>
              );
            })
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
