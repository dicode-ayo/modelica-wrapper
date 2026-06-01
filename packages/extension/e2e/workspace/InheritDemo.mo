model InheritDemo "inheritance completion fixture"
  partial model Base
    Real inheritedField;
  end Base;
  model Derived
    extends Base;
    Real ownField;
  end Derived;
  Derived d;
equation
end InheritDemo;
