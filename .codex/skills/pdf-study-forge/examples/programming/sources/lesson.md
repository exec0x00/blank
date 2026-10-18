# Authored Python lesson
This fixture concerns Python 3 formatting, not arithmetic for financial accounting. An f-string evaluates an expression inside braces. The format specification .2f displays a number with two digits after the decimal point. A dollar sign outside the braces is literal text.
Run these two lines:
price = 12
print(f"${price:.2f}")
The exact standard output is $12.00 followed by a newline. The formatting operation does not convert currencies and does not establish monetary precision for financial calculations. Binary floating point is unsuitable for some exact-decimal accounting requirements; choose an appropriate decimal representation when the application requires one. The example is deliberately an exact integer, so no binary-rounding issue affects its displayed result.
