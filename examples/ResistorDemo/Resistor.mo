within ResistorDemo;
model Resistor "Ideal linear electrical resistor"
  parameter Real R(unit = "Ohm") = 1 "Resistance";
  Real v "Voltage drop";
  Real i "Current";
equation
  v = R*i;
  annotation (
    Icon(graphics = {
      Rectangle(extent = {{-70, 30}, {70, -30}}, lineColor = {0, 0, 255}),
      Line(points = {{-90, 0}, {-70, 0}}),
      Line(points = {{70, 0}, {90, 0}}),
      Text(extent = {{-90, 60}, {90, 40}}, textString = "%name")
    }));
end Resistor;
