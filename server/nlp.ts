import nlp from "compromise";
import type { Entity, SearchResult } from "./types.js";

export function enrichWithNlp(results: SearchResult[]): SearchResult[] {
  for (const result of results) {
    const text = `${result.title}. ${result.snippet}`;
    const doc = nlp(text);
    const entities: Entity[] = [];

    const people = doc.people().out("array") as string[];
    for (const person of people) {
      if (person.length >= 2) entities.push({ text: person, label: "PERSON" });
    }

    const orgs = doc.organizations().out("array") as string[];
    for (const org of orgs) {
      if (org.length >= 2) entities.push({ text: org, label: "ORG" });
    }

    const places = doc.places().out("array") as string[];
    for (const place of places) {
      if (place.length >= 2) entities.push({ text: place, label: "GPE" });
    }

    result.entities = entities;
  }
  return results;
}

export function isNameEntityMatch(targetName: string, entities: Entity[]): boolean {
  const targetParts = targetName.toLowerCase().split(/\s+/).filter(Boolean);
  if (targetParts.length === 0) return false;

  for (const ent of entities) {
    if (ent.label !== "PERSON") continue;
    const person = ent.text.toLowerCase();
    if (targetParts.length >= 2) {
      if (targetParts.every((part) => person.includes(part))) return true;
    } else if (targetParts[0] === person || person.includes(targetParts[0])) {
      return true;
    }
  }
  return false;
}

export function aggregateEntities(results: SearchResult[], targetName: string) {
  const persons = new Map<string, number>();
  const orgs = new Map<string, number>();
  const locations = new Map<string, number>();
  const targetLower = targetName.toLowerCase();

  for (const result of results) {
    for (const ent of result.entities || []) {
      const text = ent.text.trim();
      if (text.length < 2) continue;
      if (targetLower.includes(text.toLowerCase()) || text.toLowerCase().includes(targetLower)) {
        continue;
      }

      if (ent.label === "PERSON") {
        persons.set(text, (persons.get(text) || 0) + 1);
      } else if (ent.label === "ORG") {
        orgs.set(text, (orgs.get(text) || 0) + 1);
      } else if (ent.label === "GPE" || ent.label === "LOC") {
        locations.set(text, (locations.get(text) || 0) + 1);
      }
    }
  }

  const topEntries = (map: Map<string, number>) =>
    [...map.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([name, mentions]) => ({ name, mentions }));

  return {
    relatedPersons: topEntries(persons),
    relatedOrganizations: topEntries(orgs),
    relatedLocations: topEntries(locations),
  };
}
