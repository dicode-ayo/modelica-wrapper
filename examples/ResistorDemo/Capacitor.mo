within ResistorDemo;
model Capacitor "Ideal linear electrical capacitor"
  parameter Real C(unit = "F") = 1 "Capacitance";
  Real v "Voltage drop";
  Real i "Current";
equation
  i = C*der(v);
  annotation (
    Icon(graphics = {
      Line(points = {{-14, 28}, {-14, -28}}, color = {0, 0, 255}),
      Line(points = {{14, 28}, {14, -28}}, color = {0, 0, 255}),
      Line(points = {{-90, 0}, {-14, 0}}),
      Line(points = {{14, 0}, {90, 0}}),
      Text(extent = {{-90, 60}, {90, 40}}, textString = "%name")
    }));
end Capacitor;
