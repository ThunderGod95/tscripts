export type GlossaryEntry = {
    en: string;
    cn: string;
    pinyin: string;
    type: "Person" | "Item" | "Artifact" | "Place" | "Concept/Term" | "Technique/Art/Method/Incantation/Spell" | "Unknown" | "Group" | "Creature";
    gender: "Male" | "Female" | "Unknown" | null;
    file: number | null;
};