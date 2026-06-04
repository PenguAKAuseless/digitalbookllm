"""
Named Entity Recognition (NER) Service using spaCy.
Used for extracting technical terms and entities from documents.
"""
from typing import List, Dict, Any
import re


class NERService:
    """Service for Named Entity Recognition."""

    def __init__(self):
        self._nlp = None

    def _ensure_model_loaded(self) -> None:
        """Lazy-load the spaCy model."""
        if self._nlp is None:
            import spacy
            try:
                self._nlp = spacy.load("en_core_web_sm")
            except OSError:
                import subprocess
                subprocess.run(["python", "-m", "spacy", "download", "en_core_web_sm"], check=True)
                self._nlp = spacy.load("en_core_web_sm")
            print("[NER] spaCy model loaded")

    def extract_entities(self, text: str) -> List[Dict[str, Any]]:
        """
        Extract named entities from text.

        Args:
            text: Input text

        Returns:
            List of entities with text, label, and position
        """
        self._ensure_model_loaded()

        text = text[:50000]
        doc = self._nlp(text)

        entities = []
        seen = set()

        for ent in doc.ents:
            if ent.text.lower() not in seen and len(ent.text) > 2:
                entities.append({
                    "text": ent.text,
                    "label": ent.label_,
                    "start": ent.start_char,
                    "end": ent.end_char,
                })
                seen.add(ent.text.lower())

        technical_terms = self._extract_technical_terms(text)
        for term in technical_terms:
            if term.lower() not in seen:
                entities.append({
                    "text": term,
                    "label": "TECH_TERM",
                    "start": -1,
                    "end": -1,
                })
                seen.add(term.lower())

        return entities

    def _extract_technical_terms(self, text: str) -> List[str]:
        """
        Extract technical terms using pattern matching.
        Catches acronyms, camelCase, and technical patterns.
        """
        terms = []

        acronyms = re.findall(r'\b[A-Z]{2,6}\b', text)
        terms.extend(acronyms)

        camel_case = re.findall(r'\b[A-Z][a-z]+(?:[A-Z][a-z]+)+\b', text)
        terms.extend(camel_case)

        tech_patterns = [
            r'\b\w+(?:API|SDK|CLI|GUI|UI|UX|DB|SQL|HTTP|HTTPS|TCP|UDP|IP|DNS|CSS|HTML|XML|JSON)\b',
            r'\b(?:API|SDK|CLI|GUI|UI|UX|DB|SQL|HTTP|HTTPS|TCP|UDP|IP|DNS|CSS|HTML|XML|JSON)\w+\b',
            r'\b\w+(?:Service|Controller|Manager|Handler|Factory|Builder|Provider|Repository)\b',
            r'\b\w+(?:tion|ment|ness|ity)\b',  # Common noun suffixes for technical terms
        ]

        for pattern in tech_patterns:
            matches = re.findall(pattern, text, re.IGNORECASE)
            terms.extend(matches)

        return list(set(terms))

    def extract_noun_phrases(self, text: str) -> List[str]:
        """Extract noun phrases that might be technical terms."""
        self._ensure_model_loaded()

        text = text[:50000]
        doc = self._nlp(text)

        phrases = []
        for chunk in doc.noun_chunks:
            if 2 <= len(chunk.text.split()) <= 4:
                phrases.append(chunk.text)

        return list(set(phrases))
