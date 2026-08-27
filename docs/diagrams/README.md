# Diagram sources

The two architecture figures in the top-level README are TikZ drawings, not
generated output. These are the English versions of the figures from the thesis
(`docs/thesis.pdf`, appendix "Arhitektura aplikacije in modelov").

Rebuild them with any TeX distribution that has `tikz`, `csquotes` and
`amssymb`:

```bash
cd docs/diagrams
cat > wrapper.tex <<'TEX'
\documentclass{article}
\usepackage[T1]{fontenc}
\usepackage[utf8]{inputenc}
\usepackage[paperwidth=45cm,paperheight=45cm,margin=10mm]{geometry}
\usepackage{lmodern}
\usepackage{url}
\usepackage{csquotes}
\usepackage{amssymb}
\usepackage{tikz}
\usetikzlibrary{arrows.meta, positioning, calc, fit, backgrounds}
\DeclareUrlCommand{\code}{\urlstyle{tt}}
\pagestyle{empty}
\begin{document}
\noindent\input{architecture-app.tex}
\end{document}
TEX
pdflatex wrapper.tex && pdftoppm -r 200 -png -singlefile wrapper.pdf out
```

Then crop the white margin down to the drawing before committing the PNG into
`docs/images/`.
