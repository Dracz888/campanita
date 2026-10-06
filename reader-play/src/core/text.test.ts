import { bionicPrefixLength, cleanPlainText, countChars, countWords, searchText, segmentText } from "./text";

describe("limpieza de formato", () => {
  it("elimina líneas vacías y espacios dobles", () => {
    expect(cleanPlainText("Hola    mundo\n\n\n  \nAdiós", { collapseSpaces: true, removeEmptyLines: true })).toBe("Hola mundo\nAdiós");
  });
});

describe("lectura enfocada", () => {
  it("calcula el prefijo bionic", () => {
    expect(bionicPrefixLength("a")).toBe(1);
    expect(bionicPrefixLength("sol")).toBe(1);
    expect(bionicPrefixLength("lectura", 0.45)).toBe(3);
  });

  it("marca la primera palabra de cada oración", () => {
    const { segments } = segmentText("Hola amigo. ¿Qué tal, eh", { bionic: false, sentenceStart: true });
    expect(segments.filter((s) => s.sentenceStart).map((s) => s.text)).toEqual(["Hola", "Qué"]);
    expect(segments.map((s) => s.text).join("")).toBe("Hola amigo. ¿Qué tal, eh");
  });

  it("propaga el estado de oración entre fragmentos", () => {
    const a = segmentText("Fin.", { bionic: false, sentenceStart: true });
    expect(a.atSentenceStart).toBe(true);
    const b = segmentText(" Otra", { bionic: false, sentenceStart: true }, a.atSentenceStart);
    expect(b.segments.find((s) => s.sentenceStart)?.text).toBe("Otra");
  });

  it("divide palabras para Bionic Reading conservando el texto", () => {
    const { segments } = segmentText("Leer rápido", { bionic: true, sentenceStart: false, ratio: 0.5 });
    expect(segments.filter((s) => s.bold).map((s) => s.text)).toEqual(["Le", "ráp"]);
    expect(segments.map((s) => s.text).join("")).toBe("Leer rápido");
  });
});

describe("conteos y búsqueda", () => {
  it("cuenta palabras y caracteres", () => {
    expect(countWords("El niño, l'home y co-autor.")).toBe(5);
    expect(countChars("a b\nc")).toBe(3);
  });
  it("busca sin distinguir acentos ni mayúsculas", () => {
    expect(searchText("Canción y CANCION", "cancion")).toEqual([0, 10]);
  });
});
