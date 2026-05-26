model Demo "RC circuit demo"
  parameter Real R = 1.0 "Resistance";
  Real i;
  Real v;
equation
  v = R * i;
end Demo;
