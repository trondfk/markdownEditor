# Math in MerMark Editor

A demonstration document and a set of examples for checking the visual view, the Markdown output, Marp slides and PDF printing. A formula can be edited by double-clicking it, or by pressing Enter while it has focus. Enter saves an inline formula, Ctrl+Enter saves a block, Escape cancels the edit. The 𝑥² and ∑ buttons in the toolbar insert new formulas.

## 1. Notation variants

Inline, dollars: $E=mc^2$.

Inline, LaTeX parentheses: \(U=RI\).

GitHub variant with backticks: $`a^2+b^2=c^2`$.

Block dollars on one line:

$$P=UI$$

Block dollars across several lines:

$$
Z=R+j\omega L
$$

LaTeX square brackets:

\[
Y=\frac{1}{Z}
\]

A `math` block:

```math
f_0=\frac{1}{2\pi\sqrt{LC}}
```

A `latex` block with tildes:

~~~latex
\omega_0=2\pi f_0
~~~

A `tex` block with four backticks:

````tex
Q=\frac{\omega_0 L}{R}
````

The `equation` environment, with no surrounding dollars:

\begin{equation}
\nabla\cdot\mathbf{D}=\rho
\end{equation}

The `align*` environment:

\begin{align*}
U_R &= RI \\
U_L &= j\omega LI \\
U_C &= \frac{I}{j\omega C}
\end{align*}

The `gather` environment:

\begin{gather}
a^2+b^2=c^2 \\
e^{j\pi}+1=0
\end{gather}

The `alignat` environment:

\begin{alignat}{2}
10&x+&3&y=2\\
3&x+&13&y=4
\end{alignat}

## 2. Fractions, subscripts and symbols

Subscripts: $x_i^2+x_{i+1}^2$, roots: $\sqrt{x}+\sqrt[3]{y}$.

$$
\frac{1}{1+\frac{1}{sRC}}=\frac{sRC}{1+sRC}
$$

Greek letters and operators: $\alpha+\beta=\gamma$, $\Omega\neq\omega$, $a\leq b$, $x\in\mathbb{R}$.

$$
\left|\frac{U_{out}}{U_{in}}\right|=\frac{1}{\sqrt{1+(\omega RC)^2}}
$$

Accents and vectors: $\vec{E}$, $\hat{x}$, $\overline{z}$, $\dot{x}$, $\ddot{x}$.

## 3. Integrals, sums, limits and derivatives

$$
\int_0^{\infty}e^{-at}\,dt=\frac{1}{a},\qquad a>0
$$

$$
\sum_{n=0}^{\infty}r^n=\frac{1}{1-r},\qquad |r|<1
$$

$$
\lim_{h\to0}\frac{f(x+h)-f(x)}{h}=f'(x)
$$

$$
\frac{\partial^2 u}{\partial t^2}=c^2\nabla^2u
$$

## 4. Matrices and systems

$$
\mathbf{A}=\begin{bmatrix}R_1+R_2&-R_2\\-R_2&R_2+R_3\end{bmatrix}
$$

$$
\begin{pmatrix}I_1\\I_2\end{pmatrix}=\mathbf{A}^{-1}\begin{pmatrix}U_1\\U_2\end{pmatrix}
$$

$$
\det A=\begin{vmatrix}a&b\\c&d\end{vmatrix}=ad-bc
$$

$$
u(t)=\begin{cases}0&t<0\\1&t\geq0\end{cases}
$$

$$
\begin{aligned}
\nabla\times\mathbf{E}&=-\frac{\partial\mathbf{B}}{\partial t}\\
\nabla\times\mathbf{H}&=\mathbf{J}+\frac{\partial\mathbf{D}}{\partial t}
\end{aligned}
$$

## 5. Labels, colour and equation numbers

$$
\underbrace{RI}_{\text{resistor}}+\underbrace{L\frac{dI}{dt}}_{\text{inductor}}=U(t)\tag{1}
$$

$$
\color{teal}{P}=\color{blue}{U}\cdot\color{purple}{I}
$$

$$
\boxed{H(s)=\frac{1}{1+sRC}}
$$

Macros are local to a single formula:

$$
\def\vect#1{\mathbf{#1}}\vect{E}\cdot\vect{D}
$$

## 6. Formulas inside document elements

- Resistor: $Z_R=R$.
- Inductor: $Z_L=j\omega L$.
- Capacitor: $Z_C=\frac{1}{j\omega C}$.

> Ohm's law: $U=RI$.

| Quantity | Formula |
| --- | --- |
| Real power | $P=UI\cos\varphi$ |
| Reactive power | $Q=UI\sin\varphi$ |
| Apparent power | $S=UI$ |

## 7. Examples that stay as text

Prices like $5 and $10 are not formulas. Escaped dollars: \$x\$.

Inline code: `$x^2$` and `\(x\)`.

```javascript
const literal = "$x^2$";
// $$ is also just code
```

~~~text
\[This is a code sample, not a formula\]
~~~

    $this_is_code$

## 8. Scope and limitations

Rendering covers the commands KaTeX supports, including the matrix, pmatrix, bmatrix, Bmatrix, vmatrix, Vmatrix, cases, aligned, gathered and array environments inside formulas. The equation, align, alignat and gather environments (starred versions too) may appear without dollars. The renderer numbers the unstarred environments. For numbers that stay fixed across views use `\tag{...}`; `\label` and `\ref` references are not supported. This is not a compiler for full LaTeX documents, nor for TikZ.

An invalid expression is shown as safe source text and stays editable. Commands that load external resources are blocked. PDF fonts are bundled locally. DOCX keeps the LaTeX source as text; it does not create native Word equations.

In Marp slides the alternative delimiters are normalised to dollar notation and rendered by Marp's math engine. The Markdown document keeps the original delimiters and formula text.

## Provenance

The editor nodes were adapted from chinghssu/MerMarkEditorQ, commit b165dcf4fa5efbe04ac8d03adf0fc3d1f3f54393, MIT licence. The parser, source-preserving behaviour, Marp integration and print fonts were adapted for the current MerMark Editor.
