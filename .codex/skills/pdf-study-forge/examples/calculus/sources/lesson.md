# A compact, complete lesson on partial, total and implicit derivatives
This is an original instructional fixture written for PDF Study Forge. It is not a PESU lecture, examination or transcript. No past-paper frequency is claimed.

## partial
For f(x,y)=x^2 y+sin(y), the partial derivative in x holds y fixed: f_x=2xy. The partial derivative in y holds x fixed: f_y=x^2+cos(y). Both describe slopes of coordinate sections of the surface. At (1,0), those slopes are 0 and 2. The gradient is (f_x,f_y). The directional derivative in a unit direction u is gradient f dot u; the gradient alone is not the slope in every direction. Here f_xx=2y, f_xy=f_yx=2x, and f_yy=-sin(y). Equality of mixed partials is guaranteed locally when the second partial derivatives are continuous. It should not be stated without assumptions for arbitrary functions. At (1,0), direction (3/5,4/5) gives slope 8/5. Units of a partial derivative are output units divided by the corresponding input units. Our worked coordinates are dimensionless.

## total
For differentiable f, df=f_x dx+f_y dy is a linear change estimate. It is exact as a differential; a finite increment is approximately df. Along x=x(t), y=y(t), the chain rule is dz/dt=f_x x'(t)+f_y y'(t). For z=x^2 y, x=t^2, y=1+t, direct substitution yields z=t^4+t^5, so z'=4t^3+5t^4 and z'(1)=9. The partial derivative z_x alone cannot account for both inputs changing. For f=x^2 y+sin(y) at (1,0), dx=0.02, dy=-0.01, df=-0.02. Direct evaluation is -0.0204038333341667; the discrepancy is a higher-order remainder, not a contradiction. Recompute both routes to check chain-rule work.

## implicit
For F(x,y)=0, differentiating gives F_x+F_y y'=0. If F_y is nonzero, y'=-F_x/F_y. The point must satisfy F=0. For x^2+y^2=25 at (3,4), y'=-3/4. The tangent line is y-4=-(3/4)(x-3). Differentiating 2x+2y y'=0 gives 2+2(y')^2+2y y''=0, hence y''=-(1+(y')^2)/y=-25/y^3 on this circle. At (3,4), y''=-25/64. At (5,0), F_y=0: y as a differentiable function of x fails there and the tangent is vertical. Since F_x=10, x can instead be viewed as a function of y with dx/dy=-y/x=0. A point such as (1,1) is not on the circle and cannot be used to evaluate its tangent.
