model ParamDemo "modifier-parameter completion fixture"
  partial model Base
    parameter Real baseParam = 1;
  end Base;
  model Derived
    extends Base;
    parameter Real ownParam = 2;
  end Derived;
  Derived d;
equation
end ParamDemo;
