"""
Helper script to download documents from various sources.
This script provides utilities to download the documents that require special handling.
"""

import os
import sys
from pathlib import Path

# Create docs directory
DOCS_DIR = Path("./docs")
DOCS_DIR.mkdir(exist_ok=True)


def download_wikipedia():
    """Download Wikipedia articles using wikipedia-api."""
    try:
        import wikipediaapi
    except ImportError:
        print("Installing wikipedia-api...")
        os.system(f"{sys.executable} -m pip install wikipedia-api")
        import wikipediaapi
    
    print("\n📚 Downloading Wikipedia articles...")
    wiki = wikipediaapi.Wikipedia(
        language='en',
        user_agent='DigitalBookLLM/1.0 (Educational Purpose)'
    )
    
    articles = [
        ("Roman_Republic", "roman_republic.txt")
    ]
    
    for page_name, filename in articles:
        filepath = DOCS_DIR / filename
        if filepath.exists():
            print(f"✓ {filename} already exists. Skipping.")
            continue
        
        print(f"Downloading {page_name}...")
        page = wiki.page(page_name)
        
        if page.exists():
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(page.text)
            print(f"✓ Saved to {filepath}")
        else:
            print(f"✗ Page {page_name} not found!")


def download_arxiv_pdf():
    """Download and convert arXiv papers from PDF to text."""
    try:
        import PyPDF2
        import requests
    except ImportError:
        print("Installing PyPDF2 and requests...")
        os.system(f"{sys.executable} -m pip install PyPDF2 requests")
        import PyPDF2
        import requests
    
    print("\n📄 Downloading arXiv papers...")
    
    papers = [
        ("1706.03762", "attention_is_all_you_need.txt", "Attention Is All You Need")
    ]
    
    for arxiv_id, filename, title in papers:
        filepath = DOCS_DIR / filename
        if filepath.exists():
            print(f"✓ {filename} already exists. Skipping.")
            continue
        
        print(f"Downloading {title} (arXiv:{arxiv_id})...")
        pdf_url = f"https://arxiv.org/pdf/{arxiv_id}.pdf"
        pdf_path = DOCS_DIR / f"{arxiv_id}.pdf"
        
        # Download PDF
        response = requests.get(pdf_url)
        with open(pdf_path, 'wb') as f:
            f.write(response.content)
        print(f"✓ Downloaded PDF")
        
        # Convert to text
        print("Converting PDF to text...")
        try:
            with open(pdf_path, 'rb') as f:
                reader = PyPDF2.PdfReader(f)
                text = ''
                for page in reader.pages:
                    text += page.extract_text() + '\n\n'
            
            with open(filepath, 'w', encoding='utf-8') as f:
                f.write(text)
            
            print(f"✓ Saved to {filepath}")
            
            # Clean up PDF
            pdf_path.unlink()
            print("✓ Cleaned up temporary PDF")
        except Exception as e:
            print(f"✗ Error converting PDF: {e}")


def download_openstax():
    """Instructions for downloading OpenStax books."""
    print("\n📖 OpenStax Books")
    print("=" * 60)
    print("OpenStax books require manual download or web scraping.")
    print("\nOption 1: Manual Download (Recommended)")
    print("-" * 60)
    
    books = [
        ("Biology 2e", "https://openstax.org/books/biology-2e/pages/1-introduction", "biology_2e.txt"),
        ("College Physics 2e", "https://openstax.org/books/college-physics-2e/pages/1-introduction", "college_physics_2e.txt"),
        ("Psychology 2e", "https://openstax.org/books/psychology-2e/pages/1-introduction", "psychology_2e.txt"),
        ("Principles of Economics 3e", "https://openstax.org/books/principles-economics-3e/pages/1-introduction", "principles_of_economics_3e.txt"),
    ]
    
    for title, url, filename in books:
        filepath = DOCS_DIR / filename
        if filepath.exists():
            print(f"✓ {filename} already exists")
        else:
            print(f"\n⚠ {title}")
            print(f"  URL: {url}")
            print(f"  1. Visit the URL above")
            print(f"  2. Download as PDF")
            print(f"  3. Convert to text (using pdftotext or PyPDF2)")
            print(f"  4. Save to: {filepath}")
    
    print("\n" + "=" * 60)
    print("Option 2: Web Scraping (Advanced)")
    print("-" * 60)
    print("You can scrape the content using BeautifulSoup:")
    print("""
    pip install beautifulsoup4 requests lxml
    
    # Example scraper:
    import requests
    from bs4 import BeautifulSoup
    
    # Note: You'll need to scrape all chapter pages
    # This requires building a crawler
    """)


def download_documentation():
    """Instructions for downloading documentation sites."""
    print("\n📚 Technical Documentation")
    print("=" * 60)
    print("Documentation sites require manual download or web scraping.")
    
    docs = [
        ("LangChain RAG Tutorial", "https://python.langchain.com/v0.2/docs/tutorials/rag/", "langchain_rag_docs.txt"),
        ("Hugging Face Transformers", "https://huggingface.co/docs/transformers/en/index", "huggingface_transformers_docs.txt"),
    ]
    
    for title, url, filename in docs:
        filepath = DOCS_DIR / filename
        if filepath.exists():
            print(f"✓ {filename} already exists")
        else:
            print(f"\n⚠ {title}")
            print(f"  URL: {url}")
            print(f"  Options:")
            print(f"    - Use browser extension to save as text")
            print(f"    - Use wget: wget -r -np -k {url}")
            print(f"    - Use BeautifulSoup to scrape")
            print(f"  Save to: {filepath}")


def main():
    """Main function to run all downloaders."""
    print("=" * 60)
    print("DigitalBookLLM Document Downloader")
    print("=" * 60)
    
    print("\n📥 Starting downloads...")
    
    # Auto-downloads
    try:
        download_wikipedia()
    except Exception as e:
        print(f"✗ Error downloading Wikipedia: {e}")
    
    try:
        download_arxiv_pdf()
    except Exception as e:
        print(f"✗ Error downloading arXiv: {e}")
    
    # Manual download instructions
    download_openstax()
    download_documentation()
    
    print("\n" + "=" * 60)
    print("✓ Download process complete!")
    print("=" * 60)
    print(f"\nDocuments saved to: {DOCS_DIR.absolute()}")
    print("\nNext steps:")
    print("1. Complete any manual downloads listed above")
    print("2. Run create_dataset.ipynb to generate training data")


if __name__ == "__main__":
    main()
