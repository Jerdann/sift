import type { MailCategory } from "../../shared/contracts/analysis";
import { CATEGORY_PRESENTATION } from "./mail-classifier";

export const handlingGroups = (detail: "simple" | "detailed") => {
  const groups = new Map<
    string,
    { id: string; label: string; categories: MailCategory[] }
  >();
  for (const category of Object.keys(CATEGORY_PRESENTATION) as MailCategory[]) {
    const special = ["other", "suspicious", "spam", "mailing_lists"].includes(
      category,
    );
    const label =
      category === "other"
        ? "Needs sorting"
        : CATEGORY_PRESENTATION[category].label;
    const id =
      detail === "detailed" || special
        ? category
        : CATEGORY_PRESENTATION[category].folder.split("/")[0]!;
    const group = groups.get(id) ?? {
      id,
      label: detail === "detailed" || special ? label : id,
      categories: [],
    };
    group.categories.push(category);
    groups.set(id, group);
  }
  return [...groups.values()];
};
